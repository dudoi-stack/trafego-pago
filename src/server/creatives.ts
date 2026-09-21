import type { Database } from "bun:sqlite";
import { agg, evaluateCreative, isValidDate, type CreativeStatus, type DayEntry } from "../shared/calc.ts";

export type CreativeFormat = "video" | "image" | "carousel";

export interface CreativeRow {
  id: number;
  name: string;
  product: string;
  format: CreativeFormat;
  status: CreativeStatus;
  start_date: string;
  url: string;
  notes: string;
  created_at: string;
}

export interface EntryRow {
  creative_id: number;
  date: string;
  investment_cents: number;
  sales: number;
  revenue_cents: number | null;
  clicks_meta: number;
  clicks_shopee: number;
  tax_rate: number;
}

export interface CreativeWithTotals extends CreativeRow {
  totals: {
    investment_cents: number;
    cost_cents: number;
    sales: number;
    revenue_cents: number;
    costClosed_cents: number;
    profit_cents: number | null;
    clicks_meta: number;
    clicks_shopee: number;
    cpc_meta_cents: number | null;
    cpc_shopee_cents: number | null;
    pending_days: number;
    has_pending: boolean;
  };
  health: {
    saude: "saudavel" | "atencao" | null;
    statusDisplay: string;
    ruler: string;
    motivo: string | null;
    dia1: string | null;
  };
  warnings: string[];
}

const FORMATS: CreativeFormat[] = ["video", "image", "carousel"];
const STATUSES: CreativeStatus[] = ["ativo", "escalando", "pausado", "encerrado"];

export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function entriesFor(db: Database, creativeId: number): DayEntry[] {
  const rows = db
    .query("SELECT date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate FROM daily_entries WHERE creative_id = ? ORDER BY date ASC;")
    .all(creativeId) as EntryRow[];
  return rows.map((r) => ({
    date: r.date,
    investment_cents: r.investment_cents,
    sales: r.sales,
    revenue_cents: r.revenue_cents,
    clicks_meta: r.clicks_meta,
    clicks_shopee: r.clicks_shopee,
    tax_rate: r.tax_rate,
  }));
}

function withTotals(db: Database, row: CreativeRow): CreativeWithTotals {
  const entries = entriesFor(db, row.id);
  const a = agg(entries);
  // Pré-cadastro futuro (start_date > hoje): não conta Dia 1 nem dispara Sinal,
  // mesmo que existam lançamentos antecipados — a saúde só avalia após o início.
  const isPreCadastro = row.start_date > todayLocal();
  const h = isPreCadastro
    ? { saude: null, statusDisplay: "Sem dados", ruler: "cinza", motivo: null, dia1: null }
    : evaluateCreative(row.status, entries);
  return {
    ...row,
    totals: {
      investment_cents: a.investment_cents,
      cost_cents: a.cost_cents,
      sales: a.sales,
      revenue_cents: a.revenue_cents,
      costClosed_cents: a.costClosed_cents,
      profit_cents: a.profit_cents,
      clicks_meta: a.clicks_meta,
      clicks_shopee: a.clicks_shopee,
      cpc_meta_cents: a.cpc_meta_cents,
      cpc_shopee_cents: a.cpc_shopee_cents,
      pending_days: a.pending_days,
      has_pending: a.has_pending,
    },
    health: {
      saude: h.saude,
      statusDisplay: h.statusDisplay,
      ruler: h.ruler,
      motivo: h.motivo,
      dia1: h.dia1,
    },
    warnings: [],
  };
}

export interface ListFilter {
  q?: string;
  status?: string;
  product?: string;
}

export function listCreatives(db: Database, filter: ListFilter = {}): CreativeWithTotals[] {
  const q = filter.q?.trim().toLowerCase() ?? "";
  const status = filter.status?.trim() ?? "all";
  const product = filter.product?.trim() ?? "";

  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives ORDER BY start_date DESC, id DESC;")
    .all() as CreativeRow[];

  return rows
    .filter((r) => {
      if (status !== "all" && status !== "" && r.status !== status) return false;
      if (product !== "" && r.product !== product) return false;
      if (q !== "" && !(r.name + " " + r.product).toLowerCase().includes(q)) return false;
      return true;
    })
    .map((r) => withTotals(db, r));
}

export function getCreative(db: Database, id: number): CreativeWithTotals | null {
  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives WHERE id = ?;")
    .all(id) as CreativeRow[];
  if (rows.length === 0) return null;
  return withTotals(db, rows[0]);
}

export interface CreateInput {
  name?: unknown;
  product?: unknown;
  format?: unknown;
  start_date?: unknown;
  status?: unknown;
  url?: unknown;
  notes?: unknown;
}

export interface CreateResult {
  statusCode: number;
  body: { data?: CreativeWithTotals; warnings: string[]; error?: string };
}

export function createCreative(db: Database, input: CreateInput): CreateResult {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const product = typeof input.product === "string" ? input.product.trim() : "";
  const formatRaw = typeof input.format === "string" && input.format !== "" ? input.format : "video";
  const statusRaw = typeof input.status === "string" && input.status !== "" ? input.status : "ativo";
  const startRaw = typeof input.start_date === "string" && input.start_date !== "" ? input.start_date : todayLocal();
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const notes = typeof input.notes === "string" ? input.notes : "";

  if (name === "") {
    return { statusCode: 400, body: { warnings: [], error: "nome_obrigatorio" } };
  }
  if (!FORMATS.includes(formatRaw as CreativeFormat)) {
    return { statusCode: 400, body: { warnings: [], error: "formato_invalido" } };
  }
  if (!STATUSES.includes(statusRaw as CreativeStatus)) {
    return { statusCode: 400, body: { warnings: [], error: "status_invalido" } };
  }
  if (!isValidDate(startRaw)) {
    return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
  }

  const format = formatRaw as CreativeFormat;
  const status = statusRaw as CreativeStatus;

  // Nome único case-insensitive entre não-Encerrados.
  // Índice parcial: WHERE status != 'encerrado' — novo Encerrado nunca conflita.
  if (status !== "encerrado") {
    const dup = db
      .query("SELECT id FROM creatives WHERE lower(name) = lower(?) AND status != 'encerrado' LIMIT 1;")
      .all(name) as { id: number }[];
    if (dup.length > 0) {
      return {
        statusCode: 409,
        body: {
          warnings: ["Já existe um Criativo com esse nome. Use outro nome para diferenciar."],
          error: "nome_duplicado",
        },
      };
    }
  }

  try {
    const res = db
      .query(
        "INSERT INTO creatives (name, product, format, status, start_date, url, notes) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id, name, product, format, status, start_date, url, notes, created_at;",
      )
      .all(name, product, format, status, startRaw, url, notes) as CreativeRow[];
    const created = withTotals(db, res[0]);
    return { statusCode: 201, body: { data: created, warnings: [] } };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE|unique/i.test(msg)) {
      return {
        statusCode: 409,
        body: {
          warnings: ["Já existe um Criativo com esse nome. Use outro nome para diferenciar."],
          error: "nome_duplicado",
        },
      };
    }
    throw err;
  }
}
