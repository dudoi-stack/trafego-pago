import type { Database } from "bun:sqlite";
import {
  agg,
  calcRow,
  evaluateCreative,
  evaluateDay,
  findDia1,
  hasMovement,
  isValidDate,
  type CreativeStatus,
  type DayEntry,
} from "../shared/calc.ts";

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
    roas_equivalente: number | null;
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
      roas_equivalente: a.roas_equivalente,
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
  sort?: string;
  order?: string;
}

export type LibrarySort = "recent" | "name" | "profit" | "roas" | "cost" | "sales";

function cmpNullable(a: number | null, b: number | null, dir: 1 | -1): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return (a - b) * dir;
}

export function listCreatives(db: Database, filter: ListFilter = {}): CreativeWithTotals[] {
  const q = filter.q?.trim().toLowerCase() ?? "";
  const status = filter.status?.trim() ?? "all";
  const product = filter.product?.trim() ?? "";
  const sortRaw = (filter.sort?.trim() ?? "recent").toLowerCase();
  const sort: LibrarySort =
    sortRaw === "name" || sortRaw === "profit" || sortRaw === "roas" || sortRaw === "cost" || sortRaw === "sales"
      ? (sortRaw as LibrarySort)
      : "recent";
  const orderRaw = (filter.order?.trim() ?? "").toLowerCase();
  // Ordem padrão: nome A–Z; demais métricas do maior para o menor.
  const dir: 1 | -1 =
    orderRaw === "asc" ? 1 : orderRaw === "desc" ? -1 : sort === "name" ? 1 : -1;

  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives ORDER BY start_date DESC, id DESC;")
    .all() as CreativeRow[];

  const items = rows
    .filter((r) => {
      if (status !== "all" && status !== "" && r.status !== status) return false;
      if (product !== "" && r.product !== product) return false;
      if (q !== "" && !(r.name + " " + r.product).toLowerCase().includes(q)) return false;
      return true;
    })
    .map((r) => withTotals(db, r));

  switch (sort) {
    case "name":
      items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR") * dir);
      break;
    case "profit":
      items.sort((a, b) => cmpNullable(a.totals.profit_cents, b.totals.profit_cents, dir));
      break;
    case "roas":
      items.sort((a, b) => cmpNullable(a.totals.roas_equivalente, b.totals.roas_equivalente, dir));
      break;
    case "cost":
      items.sort((a, b) => (a.totals.cost_cents - b.totals.cost_cents) * dir);
      break;
    case "sales":
      items.sort((a, b) => (a.totals.sales - b.totals.sales) * dir);
      break;
    case "recent":
    default:
      items.sort((a, b) => (a.start_date.localeCompare(b.start_date) || a.id - b.id) * dir);
      break;
  }
  return items;
}

export function getCreative(db: Database, id: number): CreativeWithTotals | null {
  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives WHERE id = ?;")
    .all(id) as CreativeRow[];
  if (rows.length === 0) return null;
  return withTotals(db, rows[0]);
}

export interface DetailEntry {
  date: string;
  investment_cents: number;
  sales: number;
  revenue_cents: number | null;
  clicks_meta: number;
  clicks_shopee: number;
  tax_rate: number;
  cost_cents: number;
  profit_cents: number | null;
  cpc_meta_cents: number | null;
  cpc_shopee_cents: number | null;
  is_pending: boolean;
  has_movement: boolean;
  is_dia1: boolean;
  signal: { saude: "saudavel" | "atencao"; motivo: string | null; ruler: "azul" | "amarelo" } | null;
}

export interface CreativeDetail {
  creative: CreativeRow;
  entries: DetailEntry[];
  totals: CreativeWithTotals["totals"];
  health: CreativeWithTotals["health"];
  months: string[];
  dia1: string | null;
}

function isValidMonth(s: string): boolean {
  if (!/^\d{4}-\d{2}$/.test(s)) return false;
  const m = Number(s.slice(5, 7));
  return m >= 1 && m <= 12;
}

/** Detalhe réplica-da-planilha: dias (recentes no topo) + TOTAL do visível + saúde global. */
export function getCreativeDetail(
  db: Database,
  id: number,
  month?: string,
): { ok: true; detail: CreativeDetail } | { ok: false; error: "not_found" | "mes_invalido" } {
  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives WHERE id = ?;")
    .all(id) as CreativeRow[];
  if (rows.length === 0) return { ok: false, error: "not_found" };
  const creative = rows[0];
  const monthFilter = month == null || month === "" || month === "all" ? undefined : month;
  if (monthFilter != null && !isValidMonth(monthFilter)) {
    return { ok: false, error: "mes_invalido" };
  }
  const allRows = db
    .query(
      "SELECT date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate FROM daily_entries WHERE creative_id = ? ORDER BY date DESC;",
    )
    .all(id) as EntryRow[];
  const allDays: DayEntry[] = allRows.map((r) => ({
    date: r.date,
    investment_cents: r.investment_cents,
    sales: r.sales,
    revenue_cents: r.revenue_cents,
    clicks_meta: r.clicks_meta,
    clicks_shopee: r.clicks_shopee,
    tax_rate: r.tax_rate,
  }));
  const dia1raw = findDia1(allDays);
  const isPreCadastro = creative.start_date > todayLocal();
  // Pré-cadastro futuro: não conta Dia 1 (igual à biblioteca).
  const dia1 = isPreCadastro ? null : dia1raw;
  const h = isPreCadastro
    ? { saude: null, statusDisplay: "Sem dados", ruler: "cinza", motivo: null, dia1: null }
    : evaluateCreative(creative.status as CreativeStatus, allDays);
  const months = [...new Set(allRows.map((r) => r.date.slice(0, 7)))].sort().reverse();
  const filtered = monthFilter ? allRows.filter((r) => r.date.startsWith(monthFilter)) : allRows;
  const filteredDays: DayEntry[] = filtered.map((r) => ({
    date: r.date,
    investment_cents: r.investment_cents,
    sales: r.sales,
    revenue_cents: r.revenue_cents,
    clicks_meta: r.clicks_meta,
    clicks_shopee: r.clicks_shopee,
    tax_rate: r.tax_rate,
  }));
  const a = agg(filteredDays);
  const entries: DetailEntry[] = filtered.map((r) => {
    const day: DayEntry = {
      date: r.date,
      investment_cents: r.investment_cents,
      sales: r.sales,
      revenue_cents: r.revenue_cents,
      clicks_meta: r.clicks_meta,
      clicks_shopee: r.clicks_shopee,
      tax_rate: r.tax_rate,
    };
    const rc = calcRow(day);
    const movement = hasMovement(day);
    const isDia1 = dia1 != null && r.date === dia1;
    const signal = movement ? evaluateDay(day, isDia1) : null;
    return {
      date: r.date,
      investment_cents: r.investment_cents,
      sales: r.sales,
      revenue_cents: r.revenue_cents,
      clicks_meta: r.clicks_meta,
      clicks_shopee: r.clicks_shopee,
      tax_rate: r.tax_rate,
      cost_cents: rc.cost_cents,
      profit_cents: rc.profit_cents,
      cpc_meta_cents: rc.cpc_meta_cents,
      cpc_shopee_cents: rc.cpc_shopee_cents,
      is_pending: rc.is_pending,
      has_movement: rc.has_movement,
      is_dia1: isDia1,
      signal,
    };
  });
  return {
    ok: true,
    detail: {
      creative,
      entries,
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
        roas_equivalente: a.roas_equivalente,
        pending_days: a.pending_days,
        has_pending: a.has_pending,
      },
      health: {
        saude: h.saude as CreativeWithTotals["health"]["saude"],
        statusDisplay: h.statusDisplay as CreativeWithTotals["health"]["statusDisplay"],
        ruler: h.ruler as CreativeWithTotals["health"]["ruler"],
        motivo: h.motivo,
        dia1: h.dia1,
      },
      months,
      dia1,
    },
  };
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

export interface BulkCreateInput {
  names?: unknown;
  items?: unknown;
  product?: unknown;
  format?: unknown;
  start_date?: unknown;
  status?: unknown;
}

export interface BulkCreateResult {
  statusCode: number;
  body: { data?: CreativeWithTotals[]; warnings: string[]; error?: string; duplicates?: string[] };
}

export function createCreativesBulk(db: Database, input: BulkCreateInput): BulkCreateResult {
  // Novo formato: items [{name, product}] (um produto por criativo).
  // Legado: names[] + product único (mantido para compatibilidade).
  let pairs: { name: string; product: string }[] = [];
  if (Array.isArray(input.items)) {
    for (const it of input.items as unknown[]) {
      if (typeof it !== "object" || it == null) continue;
      const rec = it as Record<string, unknown>;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (name === "") continue;
      const product = typeof rec.product === "string" ? rec.product.trim() : "";
      pairs.push({ name, product });
    }
  } else {
    const rawNames = Array.isArray(input.names) ? input.names : null;
    if (!rawNames) {
      return { statusCode: 400, body: { warnings: [], error: "nome_obrigatorio" } };
    }
    const product = typeof input.product === "string" ? input.product.trim() : "";
    pairs = rawNames
      .filter((n): n is string => typeof n === "string")
      .map((n) => n.trim())
      .filter((n) => n !== "")
      .map((n) => ({ name: n, product }));
  }
  const names = pairs.map((p) => p.name);
  if (names.length === 0) {
    return { statusCode: 400, body: { warnings: [], error: "nome_obrigatorio" } };
  }
  const formatRaw = typeof input.format === "string" && input.format !== "" ? input.format : "video";
  const statusRaw = typeof input.status === "string" && input.status !== "" ? input.status : "ativo";
  const startRaw = typeof input.start_date === "string" && input.start_date !== "" ? input.start_date : todayLocal();

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

  // Duplicados intra-lote (case-insensitive) recusam tudo.
  const seen = new Set<string>();
  const dupIntra: string[] = [];
  for (const n of names) {
    const k = n.toLowerCase();
    if (seen.has(k)) {
      if (!dupIntra.some((d) => d.toLowerCase() === k)) dupIntra.push(n);
    }
    seen.add(k);
  }
  if (dupIntra.length > 0) {
    return {
      statusCode: 409,
      body: {
        warnings: ["Nomes repetidos na lista. Ajuste os duplicados em vermelho antes de cadastrar."],
        error: "nome_duplicado",
        duplicates: dupIntra,
      },
    };
  }

  // Duplicados contra a base (entre não-Encerrados) recusam tudo.
  if (status !== "encerrado") {
    const placeholders = names.map(() => "?").join(",");
    const lowers = names.map((n) => n.toLowerCase());
    const rows = db
      .query(`SELECT name FROM creatives WHERE lower(name) IN (${placeholders}) AND status != 'encerrado';`)
      .all(...lowers) as { name: string }[];
    if (rows.length > 0) {
      const dups = rows.map((r) => r.name);
      return {
        statusCode: 409,
        body: {
          warnings: ["Já existe um Criativo com esse nome. Use outro nome para diferenciar."],
          error: "nome_duplicado",
          duplicates: dups,
        },
      };
    }
  }

  try {
    db.exec("BEGIN IMMEDIATE;");
    const created: CreativeWithTotals[] = [];
    const stmt = db.query(
      "INSERT INTO creatives (name, product, format, status, start_date, url, notes) VALUES (?, ?, ?, ?, ?, '', '') RETURNING id, name, product, format, status, start_date, url, notes, created_at;",
    );
    for (const p of pairs) {
      const res = stmt.all(p.name, p.product, format, status, startRaw) as CreativeRow[];
      created.push(withTotals(db, res[0]));
    }
    db.exec("COMMIT;");
    return { statusCode: 201, body: { data: created, warnings: [] } };
  } catch (err) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      // ignore
    }
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

export interface UpdateResult {
  statusCode: number;
  body: { data?: CreativeWithTotals; warnings: string[]; error?: string };
}

/** Edita o Criativo (inclui pausar/encerrar/reabrir/escalar). Encerrar nunca apaga lançamentos. */
export function updateCreative(db: Database, id: number, input: CreateInput): UpdateResult {
  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives WHERE id = ?;")
    .all(id) as CreativeRow[];
  if (rows.length === 0) {
    return { statusCode: 404, body: { warnings: [], error: "not_found" } };
  }
  const current = rows[0];
  const has = (k: string) => Object.prototype.hasOwnProperty.call(input, k);

  let name = current.name;
  if (has("name")) {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      return { statusCode: 400, body: { warnings: [], error: "nome_obrigatorio" } };
    }
    name = input.name.trim();
  }
  let product = current.product;
  if (has("product")) {
    if (typeof input.product !== "string") {
      return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
    }
    product = input.product.trim();
  }
  let format = current.format;
  if (has("format")) {
    if (typeof input.format !== "string" || !FORMATS.includes(input.format as CreativeFormat)) {
      return { statusCode: 400, body: { warnings: [], error: "formato_invalido" } };
    }
    format = input.format as CreativeFormat;
  }
  let start_date = current.start_date;
  if (has("start_date")) {
    if (typeof input.start_date !== "string" || !isValidDate(input.start_date)) {
      return { statusCode: 400, body: { warnings: [], error: "data_invalida" } };
    }
    start_date = input.start_date;
  }
  let status = current.status;
  if (has("status")) {
    if (typeof input.status !== "string" || !STATUSES.includes(input.status as CreativeStatus)) {
      return { statusCode: 400, body: { warnings: [], error: "status_invalido" } };
    }
    status = input.status as CreativeStatus;
  }
  let url = current.url;
  if (has("url")) {
    if (typeof input.url !== "string") {
      return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
    }
    url = input.url.trim();
  }
  let notes = current.notes;
  if (has("notes")) {
    if (typeof input.notes !== "string") {
      return { statusCode: 400, body: { warnings: [], error: "valor_invalido" } };
    }
    notes = input.notes;
  }

  // Escalando é selo manual só do Ativo: só Ativo vira Escalando.
  if (status === "escalando" && current.status !== "ativo" && current.status !== "escalando") {
    return {
      statusCode: 400,
      body: { warnings: ["Só criativos Ativos podem ser marcados como Escalando."], error: "escalando_so_do_ativo" },
    };
  }

  // Nome único case-insensitive entre não-Encerrados (exclui a si mesmo).
  if (status !== "encerrado") {
    const dup = db
      .query("SELECT id FROM creatives WHERE lower(name) = lower(?) AND id != ? AND status != 'encerrado' LIMIT 1;")
      .all(name, id) as { id: number }[];
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
        "UPDATE creatives SET name = ?, product = ?, format = ?, status = ?, start_date = ?, url = ?, notes = ? WHERE id = ? RETURNING id, name, product, format, status, start_date, url, notes, created_at;",
      )
      .all(name, product, format, status, start_date, url, notes, id) as CreativeRow[];
    return { statusCode: 200, body: { data: withTotals(db, res[0]), warnings: [] } };
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
