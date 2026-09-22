import type { Database } from "./runtime/database.ts";
import { agg, findDia1, healthForPeriod, isValidDate, type DayEntry } from "../shared/calc.ts";
import { todayLocal, type CreativeRow } from "./creatives.ts";
import { pendingWarning } from "./entries.ts";

export interface DashboardTotals {
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
  pending_cost_cents: number;
  has_pending: boolean;
  days: number;
}

export interface DashboardDay {
  date: string;
  cost_cents: number;
  revenue_cents: number | null;
  profit_cents: number | null;
  investment_cents: number;
  sales: number;
  pending: boolean;
  empty: boolean;
}

export interface DashboardCreative {
  creative: Pick<CreativeRow, "id" | "name" | "product" | "format" | "status" | "start_date">;
  totals: DashboardTotals;
  health: { saude: string | null; statusDisplay: string; ruler: string; motivo: string | null; dia1: string | null };
  dia1: string | null;
}

export interface DashboardFilter {
  from: string;
  to: string;
  creativeIds: number[] | null;
  status: string;
  product: string;
  decision: string;
  all: boolean;
}

export interface DashboardResult {
  period: { from: string; to: string };
  previousPeriod: { from: string; to: string } | null;
  totals: DashboardTotals;
  previousTotals: DashboardTotals | null;
  daily: DashboardDay[];
  creatives: DashboardCreative[];
  warnings: string[];
}

export type DecisionKey = "saudavel" | "atencao" | "escalando" | "pausado" | "encerrado" | "sem_dados";

function normDecision(s: string): string {
  const t = s.trim().toLowerCase();
  // Aceita "Saudável", "saudavel", "Atenção", "atencao", etc.
  const noAcc = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (noAcc === "all" || noAcc === "" || noAcc === "todas") return "all";
  if (noAcc === "saudavel") return "saudavel";
  if (noAcc === "atencao") return "atencao";
  if (noAcc === "escalando") return "escalando";
  if (noAcc === "pausado") return "pausado";
  if (noAcc === "encerrado") return "encerrado";
  if (noAcc === "sem_dados" || noAcc === "sem dados" || noAcc === "sem-dados") return "sem_dados";
  return "__invalid__";
}

function decisionOfHealth(h: { statusDisplay: string; saude: string | null }): DecisionKey | "unknown" {
  const sd = h.statusDisplay;
  if (sd === "Saudável") return "saudavel";
  if (sd === "Atenção") return "atencao";
  if (sd === "Escalando") return "escalando";
  if (sd === "Pausado") return "pausado";
  if (sd === "Encerrado") return "encerrado";
  return "sem_dados";
}

export function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function diffDays(a: string, b: string): number {
  const [ya, ma, da] = a.split("-").map(Number);
  const [yb, mb, db] = b.split("-").map(Number);
  const ms = Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da);
  return Math.round(ms / 86400000);
}

export function parseDashboardQuery(params: URLSearchParams): { ok: true; filter: DashboardFilter } | { ok: false; error: string } {
  const allRaw = (params.get("all") ?? "").trim().toLowerCase();
  const all = allRaw === "1" || allRaw === "true" || allRaw === "all";
  let from = (params.get("from") ?? "").trim();
  let to = (params.get("to") ?? "").trim();
  if (!all) {
    if (from === "" && to === "") {
      to = todayLocal();
      from = addDays(to, -29);
    } else if (from === "") {
      if (!isValidDate(to)) return { ok: false, error: "data_invalida" };
      from = addDays(to, -29);
    } else if (to === "") {
      if (!isValidDate(from)) return { ok: false, error: "data_invalida" };
      to = todayLocal();
      if (to < from) to = from;
    } else {
      if (!isValidDate(from) || !isValidDate(to)) return { ok: false, error: "data_invalida" };
      if (from > to) {
        const t = from;
        from = to;
        to = t;
      }
    }
  } else {
    // Todo o período: from/to explícitos são ignorados (o cálculo usa o menor dia).
    if (from !== "" && !isValidDate(from)) return { ok: false, error: "data_invalida" };
    if (to !== "" && !isValidDate(to)) return { ok: false, error: "data_invalida" };
  }

  const idsRaw = (params.get("creatives") ?? params.get("ids") ?? "").trim();
  let creativeIds: number[] | null = null;
  if (idsRaw !== "" && idsRaw !== "all") {
    const parts = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    const ids: number[] = [];
    for (const p of parts) {
      const n = Number(p);
      if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "valor_invalido" };
      ids.push(n);
    }
    creativeIds = ids;
  }

  const status = (params.get("status") ?? "all").trim();
  if (status !== "all" && status !== "" && !["ativo", "escalando", "pausado", "encerrado"].includes(status)) {
    return { ok: false, error: "status_invalido" };
  }
  const product = (params.get("product") ?? "").trim();
  const decision = normDecision(params.get("decision") ?? params.get("decisao") ?? "all");
  if (decision === "__invalid__") return { ok: false, error: "decisao_invalida" };

  return {
    ok: true,
    filter: {
      from,
      to,
      creativeIds,
      status: status === "" ? "all" : status,
      product,
      decision,
      all,
    },
  };
}

interface LoadedCreative {
  row: CreativeRow;
  allDays: DayEntry[];
  globalDia1: string | null;
}

function loadAll(db: Database): LoadedCreative[] {
  const rows = db
    .query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives ORDER BY id ASC;")
    .all() as CreativeRow[];
  return rows.map((row) => {
    const erows = db
      .query("SELECT date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate FROM daily_entries WHERE creative_id = ? ORDER BY date ASC;")
      .all(row.id) as {
      date: string;
      investment_cents: number;
      sales: number;
      revenue_cents: number | null;
      clicks_meta: number;
      clicks_shopee: number;
      tax_rate: number;
    }[];
    const allDays: DayEntry[] = erows.map((r) => ({
      date: r.date,
      investment_cents: r.investment_cents,
      sales: r.sales,
      revenue_cents: r.revenue_cents,
      clicks_meta: r.clicks_meta,
      clicks_shopee: r.clicks_shopee,
      tax_rate: r.tax_rate,
    }));
    const rawDia1 = findDia1(allDays);
    const isPre = row.start_date > todayLocal();
    return { row, allDays, globalDia1: isPre ? null : rawDia1 };
  });
}

function toTotals(entries: DayEntry[]): DashboardTotals {
  const a = agg(entries);
  return {
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
    pending_cost_cents: a.pending_cost_cents,
    has_pending: a.has_pending,
    days: a.days,
  };
}

export function getDashboard(db: Database, filter: DashboardFilter): DashboardResult {
  const loaded = loadAll(db);
  // Filtros de criativo (antes da decisão).
  let cand = loaded.filter((l) => {
    if (filter.creativeIds != null && !filter.creativeIds.includes(l.row.id)) return false;
    if (filter.status !== "all" && l.row.status !== filter.status) return false;
    if (filter.product !== "" && l.row.product !== filter.product) return false;
    return true;
  });

  // Resolve período "Todo o período".
  let from = filter.from;
  let to = filter.to;
  if (filter.all) {
    to = filter.to !== "" && isValidDate(filter.to) ? filter.to : todayLocal();
    let min: string | null = null;
    for (const l of cand) {
      for (const e of l.allDays) {
        if (e.date <= to && (min == null || e.date < min)) min = e.date;
      }
    }
    from = filter.from !== "" && isValidDate(filter.from) ? filter.from : (min ?? to);
    if (from > to) {
      const t = from;
      from = to;
      to = t;
    }
  }

  // Saúde no período + filtro de decisão.
  const perCreative = cand.map((l) => {
    const periodEntries = l.allDays.filter((e) => e.date >= from && e.date <= to);
    const isPre = l.row.start_date > todayLocal();
    const h = isPre
      ? { saude: null, statusDisplay: "Sem dados", ruler: "cinza", motivo: null, dia1: null as string | null }
      : healthForPeriod(l.row.status as "ativo" | "escalando" | "pausado" | "encerrado", l.globalDia1, periodEntries);
    return { loaded: l, periodEntries, health: h };
  });
  const kept =
    filter.decision === "all"
      ? perCreative
      : perCreative.filter((p) => decisionOfHealth({ statusDisplay: p.health.statusDisplay, saude: p.health.saude }) === filter.decision);

  const keptIds = new Set(kept.map((k) => k.loaded.row.id));
  const curEntries: DayEntry[] = [];
  for (const k of kept) curEntries.push(...k.periodEntries);
  const totals = toTotals(curEntries);

  // Período anterior: mesmo tamanho, imediatamente antes. Nulo no modo "all".
  let previousPeriod: { from: string; to: string } | null = null;
  let previousTotals: DashboardTotals | null = null;
  if (!filter.all) {
    const len = diffDays(from, to) + 1;
    const pTo = addDays(from, -1);
    const pFrom = addDays(pTo, -(len - 1));
    previousPeriod = { from: pFrom, to: pTo };
    const prevEntries: DayEntry[] = [];
    for (const k of kept) {
      // Usa os dias do criativo (não só do período atual) para o anterior.
      for (const e of k.loaded.allDays) {
        if (keptIds.has(k.loaded.row.id) && e.date >= pFrom && e.date <= pTo) prevEntries.push(e);
      }
    }
    previousTotals = toTotals(prevEntries);
  }

  // Série diária do período.
  const len = diffDays(from, to) + 1;
  const daily: DashboardDay[] = [];
  for (let i = 0; i < len; i += 1) {
    const date = addDays(from, i);
    const es = curEntries.filter((e) => e.date === date);
    if (es.length === 0) {
      daily.push({ date, cost_cents: 0, revenue_cents: null, profit_cents: null, investment_cents: 0, sales: 0, pending: false, empty: true });
      continue;
    }
    const a = agg(es);
    daily.push({
      date,
      cost_cents: a.cost_cents,
      revenue_cents: a.costClosed_cents > 0 ? a.revenue_cents : null,
      profit_cents: a.profit_cents,
      investment_cents: a.investment_cents,
      sales: a.sales,
      pending: a.has_pending,
      empty: false,
    });
  }

  const creatives: DashboardCreative[] = kept.map((k) => ({
    creative: {
      id: k.loaded.row.id,
      name: k.loaded.row.name,
      product: k.loaded.row.product,
      format: k.loaded.row.format,
      status: k.loaded.row.status,
      start_date: k.loaded.row.start_date,
    },
    totals: toTotals(k.periodEntries),
    health: {
      saude: k.health.saude,
      statusDisplay: k.health.statusDisplay,
      ruler: k.health.ruler,
      motivo: k.health.motivo,
      dia1: k.health.dia1,
    },
    dia1: k.health.dia1,
  }));
  // Ordenação padrão da tabela: lucro desc (pendente/sem dados por último).
  creatives.sort((a, b) => {
    const pa = a.totals.profit_cents;
    const pb = b.totals.profit_cents;
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pb - pa;
  });

  const warnings: string[] = [];
  const pw = pendingWarning(totals.pending_days);
  if (pw) warnings.push(pw);
  return { period: { from, to }, previousPeriod, totals, previousTotals, daily, creatives, warnings };
}
