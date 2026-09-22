import type { Database } from "./runtime/database.ts";
import { findDia1, hasMovement, isValidDate } from "../shared/calc.ts";
import { getTaxRate } from "./settings.ts";
import type { CreativeRow, EntryRow } from "./creatives.ts";

export interface DayRow {
  creative: { id: number; name: string; product: string; format: string; status: string };
  entry: EntryRow | null;
  dia1: string | null;
  tax_rate: number;
}

export function currentTaxRate(db: Database): number {
  return getTaxRate(db);
}

function toNumOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  if (typeof v === "string") {
    const s = v.trim();
    if (s === "") return null;
    const n = Number(s.replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

export interface NormalizedEntry {
  investment_cents: number;
  sales: number;
  revenue_cents: number | null;
  clicks_meta: number;
  clicks_shopee: number;
}

export function normalizeEntryFields(raw: Record<string, unknown>):
  | { ok: true; value: NormalizedEntry }
  | { ok: false; error: string } {
  // Só três validações (spec #6): nada negativo; vendas/cliques inteiros; nome único.
  // Centavos com fração são arredondados (nunca recusados): a 4ª validação não existe.
  const inv = toNumOrNull(raw.investment_cents) ?? 0;
  const sales = toNumOrNull(raw.sales) ?? 0;
  const revRaw = toNumOrNull(raw.revenue_cents);
  const rev = revRaw == null ? null : Math.round(revRaw);
  const clM = toNumOrNull(raw.clicks_meta) ?? 0;
  const clS = toNumOrNull(raw.clicks_shopee) ?? 0;

  for (const n of [inv, sales, clM, clS]) {
    if (typeof n !== "number" || Number.isNaN(n)) return { ok: false, error: "valor_invalido" };
  }
  if (rev != null && (typeof rev !== "number" || Number.isNaN(rev))) {
    return { ok: false, error: "valor_invalido" };
  }
  if (inv < 0 || sales < 0 || clM < 0 || clS < 0 || (rev != null && rev < 0)) {
    return { ok: false, error: "valor_negativo" };
  }
  if (!Number.isInteger(sales) || !Number.isInteger(clM) || !Number.isInteger(clS)) {
    return { ok: false, error: "valor_invalido" };
  }
  return { ok: true, value: { investment_cents: Math.round(inv), sales, revenue_cents: rev, clicks_meta: clM, clicks_shopee: clS } };
}

export function pendingWarning(count: number): string | null {
  if (count <= 0) return null;
  return count === 1
    ? "1 lançamento com faturamento pendente: vendeu mas o faturamento ainda não foi preenchido — fica fora do lucro até você preencher."
    : `${count} lançamentos com faturamento pendente: venderam mas o faturamento ainda não foi preenchido — ficam fora do lucro até você preencher.`;
}

function dia1For(db: Database, creativeId: number): string | null {
  const rows = db
    .query(
      "SELECT date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee FROM daily_entries WHERE creative_id = ?;",
    )
    .all(creativeId) as {
    date: string;
    investment_cents: number;
    sales: number;
    revenue_cents: number | null;
    clicks_meta: number;
    clicks_shopee: number;
  }[];
  return findDia1(rows.filter(hasMovement));
}

export function getDay(db: Database, date: string): DayRow[] {
  const tax = currentTaxRate(db);
  const creatives = db
    .query(
      "SELECT id, name, product, format, status FROM creatives WHERE status IN ('ativo','escalando') ORDER BY id ASC;",
    )
    .all() as Pick<CreativeRow, "id" | "name" | "product" | "format" | "status">[];
  return creatives.map((c) => {
    const rows = db
      .query(
        "SELECT creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate FROM daily_entries WHERE creative_id = ? AND date = ?;",
      )
      .all(c.id, date) as EntryRow[];
    return {
      creative: { id: c.id, name: c.name, product: c.product, format: c.format, status: c.status },
      entry: rows.length > 0 ? rows[0] : null,
      dia1: dia1For(db, c.id),
      tax_rate: rows.length > 0 ? rows[0].tax_rate : tax,
    };
  });
}

export interface SaveBulkResult {
  statusCode: number;
  body: { data?: EntryRow[]; warnings: string[]; error?: string };
}

export function saveDayBulk(db: Database, date: string, rawEntries: unknown): SaveBulkResult {
  if (!isValidDate(date)) {
    return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
  }
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    return { statusCode: 400, body: { warnings: [], error: "lancamentos_vazio" } };
  }

  // Valida tudo antes de tocar o banco (tudo-ou-nada).
  const parsed: { creative_id: number; value: NormalizedEntry }[] = [];
  for (const item of rawEntries) {
    if (typeof item !== "object" || item == null) {
      return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
    }
    const rec = item as Record<string, unknown>;
    const cid = typeof rec.creative_id === "number" ? rec.creative_id : Number(rec.creative_id);
    if (!Number.isInteger(cid) || cid <= 0) {
      return { statusCode: 400, body: { warnings: [], error: "criativo_nao_encontrado" } };
    }
    const rows = db.query("SELECT id, status FROM creatives WHERE id = ?;").all(cid) as {
      id: number;
      status: string;
    }[];
    if (rows.length === 0) {
      return { statusCode: 400, body: { warnings: [], error: "criativo_nao_encontrado" } };
    }
    if (rows[0].status === "encerrado") {
      return { statusCode: 400, body: { warnings: [], error: "encerrado_sem_lancamento" } };
    }
    const norm = normalizeEntryFields(rec);
    if (!norm.ok) {
      return { statusCode: 400, body: { warnings: [], error: norm.error } };
    }
    parsed.push({ creative_id: cid, value: norm.value });
  }

  const tax = currentTaxRate(db);
  try {
    db.exec("BEGIN IMMEDIATE;");
    const stmt = db.query(
      `INSERT INTO daily_entries (creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT (creative_id, date) DO UPDATE SET
         investment_cents = excluded.investment_cents,
         sales = excluded.sales,
         revenue_cents = excluded.revenue_cents,
         clicks_meta = excluded.clicks_meta,
         clicks_shopee = excluded.clicks_shopee,
         updated_at = datetime('now','localtime')
       RETURNING creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate;`,
    );
    const saved: EntryRow[] = [];
    for (const p of parsed) {
      const existing = db
        .query("SELECT tax_rate FROM daily_entries WHERE creative_id = ? AND date = ?;")
        .all(p.creative_id, date) as { tax_rate: number }[];
      const rate = existing.length > 0 ? existing[0].tax_rate : tax;
      const rows = stmt.all(
        p.creative_id,
        date,
        p.value.investment_cents,
        p.value.sales,
        p.value.revenue_cents,
        p.value.clicks_meta,
        p.value.clicks_shopee,
        rate,
      ) as EntryRow[];
      saved.push(rows[0]);
    }
    db.exec("COMMIT;");
    const pend = saved.filter((e) => e.revenue_cents == null && e.sales > 0).length;
    const warnings = pend > 0 && pendingWarning(pend) ? [pendingWarning(pend)!] : [];
    return { statusCode: 200, body: { data: saved, warnings } };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}

export interface SaveOneResult {
  statusCode: number;
  body: { data?: EntryRow; warnings: string[]; error?: string };
}

export function saveOneEntry(
  db: Database,
  creativeId: number,
  date: string,
  raw: Record<string, unknown>,
): SaveOneResult {
  const r = saveDayBulk(db, date, [{ ...raw, creative_id: creativeId }]);
  if (r.statusCode !== 200 || !r.body.data) {
    const err = r.body.error ?? "valor_invalido";
    const code = err === "criativo_nao_encontrado" ? 404 : 400;
    return { statusCode: code, body: { warnings: [], error: err } };
  }
  return { statusCode: 200, body: { data: r.body.data[0], warnings: r.body.warnings } };
}

export interface DeleteOneResult {
  statusCode: number;
  body: { data?: { creative_id: number; date: string }; warnings: string[]; error?: string };
}

/** Exclui o lançamento de um dia (DELETE físico do par criativo+data). */
export function deleteOneEntry(db: Database, creativeId: number, date: string): DeleteOneResult {
  if (!Number.isInteger(creativeId) || creativeId <= 0) {
    return { statusCode: 404, body: { warnings: [], error: "criativo_nao_encontrado" } };
  }
  if (!isValidDate(date)) {
    return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
  }
  const crows = db.query("SELECT id, status FROM creatives WHERE id = ?;").all(creativeId) as {
    id: number;
    status: string;
  }[];
  if (crows.length === 0) {
    return { statusCode: 404, body: { warnings: [], error: "criativo_nao_encontrado" } };
  }
  if (crows[0].status === "encerrado") {
    return { statusCode: 400, body: { warnings: [], error: "encerrado_sem_lancamento" } };
  }
  const existing = db
    .query("SELECT creative_id FROM daily_entries WHERE creative_id = ? AND date = ?;")
    .all(creativeId, date) as { creative_id: number }[];
  if (existing.length === 0) {
    return { statusCode: 404, body: { warnings: [], error: "lancamento_nao_encontrado" } };
  }
  db.query("DELETE FROM daily_entries WHERE creative_id = ? AND date = ?;").run(creativeId, date);
  return { statusCode: 200, body: { data: { creative_id: creativeId, date }, warnings: [] } };
}

export interface SaveCreativeBulkResult {
  statusCode: number;
  body: { data?: { saved: EntryRow[]; deleted: string[] }; warnings: string[]; error?: string };
}

/**
 * Salva o Detalhe em lote: upserts das linhas sujas + deletes das marcadas,
 * tudo numa transação só (tudo-ou-nada). Dia 1/Sinal/TOTAL recalculam
 * sozinhos na leitura (findDia1 ignora dias sem movimento).
 */
export function saveCreativeBulk(
  db: Database,
  creativeId: number,
  rawEntries: unknown,
  rawDeletions: unknown,
): SaveCreativeBulkResult {
  if (!Number.isInteger(creativeId) || creativeId <= 0) {
    return { statusCode: 404, body: { warnings: [], error: "criativo_nao_encontrado" } };
  }
  const crows = db.query("SELECT id, status FROM creatives WHERE id = ?;").all(creativeId) as {
    id: number;
    status: string;
  }[];
  if (crows.length === 0) {
    return { statusCode: 404, body: { warnings: [], error: "criativo_nao_encontrado" } };
  }
  if (crows[0].status === "encerrado") {
    return { statusCode: 400, body: { warnings: [], error: "encerrado_sem_lancamento" } };
  }
  const entries = Array.isArray(rawEntries) ? rawEntries : null;
  const deletions = Array.isArray(rawDeletions) ? rawDeletions : [];
  if (entries == null) {
    return { statusCode: 400, body: { warnings: [], error: "lancamentos_vazio" } };
  }
  if (entries.length === 0 && deletions.length === 0) {
    return { statusCode: 400, body: { warnings: [], error: "lancamentos_vazio" } };
  }
  for (const d of deletions) {
    if (typeof d !== "string" || !isValidDate(d)) {
      return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
    }
  }
  const parsed: { date: string; value: NormalizedEntry }[] = [];
  for (const item of entries) {
    if (typeof item !== "object" || item == null) {
      return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
    }
    const rec = item as Record<string, unknown>;
    const date = typeof rec.date === "string" ? rec.date : "";
    if (!isValidDate(date)) {
      return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
    }
    const norm = normalizeEntryFields(rec);
    if (!norm.ok) {
      return { statusCode: 400, body: { warnings: [], error: norm.error } };
    }
    parsed.push({ date, value: norm.value });
  }

  const tax = currentTaxRate(db);
  try {
    db.exec("BEGIN IMMEDIATE;");
    for (const d of deletions) {
      db.query("DELETE FROM daily_entries WHERE creative_id = ? AND date = ?;").run(creativeId, d);
    }
    const stmt = db.query(
      `INSERT INTO daily_entries (creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now','localtime'))
       ON CONFLICT (creative_id, date) DO UPDATE SET
         investment_cents = excluded.investment_cents,
         sales = excluded.sales,
         revenue_cents = excluded.revenue_cents,
         clicks_meta = excluded.clicks_meta,
         clicks_shopee = excluded.clicks_shopee,
         updated_at = datetime('now','localtime')
       RETURNING creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate;`,
    );
    const saved: EntryRow[] = [];
    for (const p of parsed) {
      const existing = db
        .query("SELECT tax_rate FROM daily_entries WHERE creative_id = ? AND date = ?;")
        .all(creativeId, p.date) as { tax_rate: number }[];
      const rate = existing.length > 0 ? existing[0].tax_rate : tax;
      const rows = stmt.all(
        creativeId,
        p.date,
        p.value.investment_cents,
        p.value.sales,
        p.value.revenue_cents,
        p.value.clicks_meta,
        p.value.clicks_shopee,
        rate,
      ) as EntryRow[];
      saved.push(rows[0]);
    }
    db.exec("COMMIT;");
    const pend = saved.filter((e) => e.revenue_cents == null && e.sales > 0).length;
    const warnings = pend > 0 && pendingWarning(pend) ? [pendingWarning(pend)!] : [];
    return { statusCode: 200, body: { data: { saved, deleted: deletions as string[] }, warnings } };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
    throw err;
  }
}
