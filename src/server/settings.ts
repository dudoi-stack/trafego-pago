import type { Database } from "bun:sqlite";

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

export function updateSettings(
  db: Database,
  input: Record<string, unknown>,
): { statusCode: number; body: { data?: { tax_rate: number }; warnings: string[]; error?: string } } {
  if (!Object.prototype.hasOwnProperty.call(input, "tax_rate")) {
    return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
  }
  const parsed = parseTaxInput(input.tax_rate);
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
  }
  // Arredonda para 4 casas (ex: 0,1386) sem reescrever os dias antigos:
  // daily_entries.tax_rate continua intacto; só os próximos lançamentos usam a nova taxa.
  const rounded = Math.round(parsed * 10000) / 10000;
  db.query("INSERT INTO settings (key, value) VALUES ('tax_rate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value;").run(String(rounded));
  return { statusCode: 200, body: { data: { tax_rate: rounded }, warnings: [] } };
}
