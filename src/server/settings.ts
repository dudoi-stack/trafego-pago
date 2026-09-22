import type { Database } from "bun:sqlite";
import { isValidDate } from "../shared/calc.ts";

export const DEFAULT_TAX_RATE = 0.1386;

export function getTaxRate(db: Database): number {
  try {
    const rows = db.query("SELECT value FROM settings WHERE key = 'tax_rate';").all() as { value: string }[];
    const v = rows.length > 0 ? Number(rows[0].value) : NaN;
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : DEFAULT_TAX_RATE;
  } catch {
    return DEFAULT_TAX_RATE;
  }
}

/** Aceita decimal (0,1386), percent ("13,86", "13.86", "13,86%") ou número >1 como percent. */
export function parseTaxInput(v: unknown): number | null {
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return null;
    if (v > 1 && v <= 100) return v / 100;
    return v;
  }
  if (typeof v === "string") {
    let s = v.trim().replace("%", "").trim();
    if (s === "") return null;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n > 1 && n <= 100) return n / 100;
    return n;
  }
  return null;
}

export function getSettings(db: Database): { tax_rate: number } {
  return { tax_rate: getTaxRate(db) };
}

/** Quantos lançamentos seriam reescritos por um corte em `from` (date >= from). */
export function countAffectedByCutoff(db: Database, from: string): number {
  try {
    const rows = db
      .query("SELECT COUNT(*) AS n FROM daily_entries WHERE date >= ?;")
      .all(from) as { n: number }[];
    return rows.length > 0 ? Number(rows[0].n) || 0 : 0;
  } catch {
    return 0;
  }
}

/** Data local de hoje (AAAA-MM-DD) sem depender do relógio do navegador. */
export function serverTodayLocal(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function updateSettings(
  db: Database,
  input: Record<string, unknown>,
): { statusCode: number; body: { data?: { tax_rate: number; affected?: number }; warnings: string[]; error?: string } } {
  if (!Object.prototype.hasOwnProperty.call(input, "tax_rate")) {
    return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
  }
  const parsed = parseTaxInput(input.tax_rate);
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
  }
  // Corte: chave ausente = legado (só futuros, sem rewrite); chave presente
  // vazia = hoje (a UI sempre envia data explícita, com hoje como padrão).
  const hasCutoff = Object.prototype.hasOwnProperty.call(input, "effective_from");
  const rawInput = typeof input.effective_from === "string" ? input.effective_from.trim() : "";
  const rawCutoff = hasCutoff && rawInput === "" ? serverTodayLocal() : rawInput;
  if (rawCutoff !== "" && !isValidDate(rawCutoff)) {
    return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
  }
  // Arredonda para 4 casas (ex: 0,1386).
  // Sem corte: só os próximos lançamentos usam a nova taxa (dias antigos intactos).
  // Com corte: reescreve daily_entries.tax_rate onde date >= corte.
  const rounded = Math.round(parsed * 10000) / 10000;
  db.query("INSERT INTO settings (key, value) VALUES ('tax_rate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;").run(String(rounded));
  if (rawCutoff === "") {
    return { statusCode: 200, body: { data: { tax_rate: rounded, affected: 0 }, warnings: [] } };
  }
  try {
    const res = db.query("UPDATE daily_entries SET tax_rate = ?, updated_at = datetime('now','localtime') WHERE date >= ?;").run(rounded, rawCutoff);
    const affected = typeof (res as { changes?: unknown }).changes === "number" ? Number((res as { changes: number }).changes) : countAffectedByCutoff(db, rawCutoff);
    return { statusCode: 200, body: { data: { tax_rate: rounded, affected }, warnings: [] } };
  } catch {
    return { statusCode: 200, body: { data: { tax_rate: rounded, affected: 0 }, warnings: [] } };
  }
}
