// src/shared/calc.ts — Módulo único de cálculo (spec #6, T2).
// Sem dependências: importado pelo servidor e servido ao navegador para o ao-vivo.
// Qualquer cálculo fora deste módulo é bug.
//
// Convenções:
// - Dinheiro em centavos (inteiro no banco). Custo tem fração (invest × (1+taxa))
//   e a soma NUNCA arredonda — arredonda só na exibição.
// - Datas sempre "AAAA-MM-DD".
// - CPCs em centavos por clique (null = indefinido). Limite Dia 1: 0,10 → 10 centavos.
// - Sem ROAS (removido da spec). Sem "coletando dados".

export type CreativeStatus = "ativo" | "escalando" | "pausado" | "encerrado";

export interface DayEntry {
  date: string; // AAAA-MM-DD
  investment_cents: number;
  sales: number;
  revenue_cents: number | null; // null = pendente (faturamento ainda não lançado)
  clicks_meta: number;
  clicks_shopee: number;
  tax_rate: number; // ex: 0.1386
}

export interface RowCalc {
  cost_cents: number;
  profit_cents: number | null; // null = pendente (vendeu e não preencheu)
  cpc_meta_cents: number | null;
  cpc_shopee_cents: number | null;
  is_pending: boolean;
  has_movement: boolean;
}

export interface Agg {
  investment_cents: number;
  cost_cents: number;
  sales: number;
  clicks_meta: number;
  clicks_shopee: number;
  revenue_cents: number;
  costClosed_cents: number;
  profit_cents: number | null;
  cpc_meta_cents: number | null;
  cpc_shopee_cents: number | null;
  /** ROAS-equivalente = faturamento ÷ custo fechado (null sem custo fechado).
   *  Só ordenação/comparação — nunca decide cor (a decisão é o Sinal). */
  roas_equivalente: number | null;
  pending_days: number;
  pending_cost_cents: number;
  has_pending: boolean;
  days: number;
}

export type Saude = "saudavel" | "atencao";
export type Ruler = "vermelho" | "amarelo" | "azul" | "verde" | "cinza";

export interface DaySignal {
  saude: Saude;
  motivo: string | null;
  ruler: "azul" | "amarelo";
}

export interface CreativeHealth {
  saude: Saude | null; // null = sem avaliar (pausado/encerrado ou sem movimento)
  statusDisplay: "Saudável" | "Atenção" | "Escalando" | "Pausado" | "Encerrado" | "Sem dados";
  ruler: Ruler;
  motivo: string | null;
  dia1: string | null;
}

/** Limite Dia 1: CPC Meta > 0,10 → Atenção. Em centavos: 10. */
export const CPC_META_LIMITE_CENTS = 10;

export function costOf(e: Pick<DayEntry, "investment_cents" | "tax_rate">): number {
  return e.investment_cents * (1 + e.tax_rate);
}

/** Dia só conta com movimento: investimento, cliques, vendas ou faturamento. */
export function hasMovement(
  e: Pick<DayEntry, "investment_cents" | "sales" | "revenue_cents" | "clicks_meta" | "clicks_shopee">,
): boolean {
  if (e.investment_cents > 0) return true;
  if (e.clicks_meta > 0) return true;
  if (e.clicks_shopee > 0) return true;
  if (e.sales > 0) return true;
  if (e.revenue_cents != null && e.revenue_cents > 0) return true;
  return false;
}

export function calcRow(e: DayEntry): RowCalc {
  const cost_cents = costOf(e);
  const is_pending = e.revenue_cents == null && e.sales > 0;
  // Zero vendas + vazio = zero: vazio vira 0, lucro = 0 − custo.
  const profit_cents = e.revenue_cents == null ? (e.sales > 0 ? null : 0 - cost_cents) : e.revenue_cents - cost_cents;
  const cpc_meta_cents = e.clicks_meta > 0 ? e.investment_cents / e.clicks_meta : null;
  const cpc_shopee_cents = e.clicks_shopee > 0 ? e.investment_cents / e.clicks_shopee : null;
  return { cost_cents, profit_cents, cpc_meta_cents, cpc_shopee_cents, is_pending, has_movement: hasMovement(e) };
}

export function agg(entries: DayEntry[]): Agg {
  let investment_cents = 0;
  let cost_cents = 0;
  let sales = 0;
  let clicks_meta = 0;
  let clicks_shopee = 0;
  let revenue_cents = 0;
  let costClosed_cents = 0;
  const pendDates = new Set<string>();
  let pending_cost_cents = 0;

  for (const e of entries) {
    const cost = costOf(e);
    investment_cents += e.investment_cents;
    cost_cents += cost;
    sales += e.sales;
    clicks_meta += e.clicks_meta;
    clicks_shopee += e.clicks_shopee;
    if (e.revenue_cents == null && e.sales > 0) {
      pendDates.add(e.date);
      pending_cost_cents += cost;
    } else {
      revenue_cents += e.revenue_cents ?? 0;
      costClosed_cents += cost;
    }
  }

  const pending_days = pendDates.size;
  const has_pending = pending_days > 0;
  // Sem dias fechados e sem faturamento → lucro null (pendente/sem dados).
  // Com dias de zero-venda+vazio, costClosed > 0 e lucro = 0 − custo (prejuízo real).
  const hasClosed = costClosed_cents > 0 || revenue_cents > 0;
  const profit_cents = hasClosed ? revenue_cents - costClosed_cents : entries.length > 0 && !has_pending ? revenue_cents - costClosed_cents : null;
  // ROAS-equivalente: Σ faturamento ÷ Σ custo fechado (nunca média diária).
  // Null sem custo fechado (a tela mostra "—"). Não decide cor.
  const roas_equivalente = costClosed_cents > 0 ? revenue_cents / costClosed_cents : null;

  return {
    investment_cents,
    cost_cents,
    sales,
    clicks_meta,
    clicks_shopee,
    revenue_cents,
    costClosed_cents,
    profit_cents,
    cpc_meta_cents: clicks_meta > 0 ? investment_cents / clicks_meta : null,
    cpc_shopee_cents: clicks_shopee > 0 ? investment_cents / clicks_shopee : null,
    roas_equivalente,
    pending_days,
    pending_cost_cents,
    has_pending,
    days: entries.length,
  };
}

/** Primeiro dia com movimento (ordenado por data). Pré-cadastro sem movimento → null. */
export function findDia1(entries: Pick<DayEntry, "date" | "investment_cents" | "sales" | "revenue_cents" | "clicks_meta" | "clicks_shopee">[]): string | null {
  let min: string | null = null;
  for (const e of entries) {
    if (!hasMovement(e)) continue;
    if (min == null || e.date < min) min = e.date;
  }
  return min;
}

function fmtCpcBR(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}

/**
 * Sinal do dia (só para dias COM movimento; dias parados nunca chegam aqui).
 * - Dia 1: CPC Meta > 0,10 ou CPC Shopee >= CPC Meta (ou CPC indefinido com
 *   gasto, ou cliques sem investimento) → Atenção.
 * - Dia 2+: sem venda no dia → Atenção.
 * - Cookie (venda sem invest/cliques) → Saudável (azul).
 */
export function evaluateDay(
  e: DayEntry,
  isDia1: boolean,
): DaySignal {
  const cpcM = e.clicks_meta > 0 ? e.investment_cents / e.clicks_meta : null;
  const cpcS = e.clicks_shopee > 0 ? e.investment_cents / e.clicks_shopee : null;
  const hasClicks = e.clicks_meta > 0 || e.clicks_shopee > 0;

  if (isDia1) {
    // Cookie: só venda residual, sem gasto nem cliques → azul.
    if (e.investment_cents === 0 && !hasClicks) {
      if (e.revenue_cents == null && e.sales > 0) {
        return { saude: "saudavel", motivo: "vendeu · preencher faturamento", ruler: "azul" };
      }
      return { saude: "saudavel", motivo: null, ruler: "azul" };
    }
    // Cliques sem investimento → Atenção.
    if (e.investment_cents === 0 && hasClicks) {
      return { saude: "atencao", motivo: "cliques sem investimento", ruler: "amarelo" };
    }
    // CPC indefinido com gasto (sem cliques) → Atenção.
    if (e.investment_cents > 0 && !hasClicks) {
      return { saude: "atencao", motivo: "CPC indefinido com gasto", ruler: "amarelo" };
    }
    // CPC Meta indefinido com gasto (ex: só Shopee tem clique) → Atenção.
    if (cpcM == null && e.investment_cents > 0) {
      return { saude: "atencao", motivo: "CPC indefinido com gasto", ruler: "amarelo" };
    }
    if (cpcM != null && cpcM > CPC_META_LIMITE_CENTS) {
      return { saude: "atencao", motivo: `CPC Meta ${fmtCpcBR(cpcM)}`, ruler: "amarelo" };
    }
    if (cpcM != null && cpcS != null && cpcS >= cpcM) {
      return { saude: "atencao", motivo: `CPC Shopee ${fmtCpcBR(cpcS)}`, ruler: "amarelo" };
    }
    if (e.revenue_cents == null && e.sales > 0) {
      return { saude: "saudavel", motivo: "vendeu · preencher faturamento", ruler: "azul" };
    }
    return { saude: "saudavel", motivo: null, ruler: "azul" };
  }

  // Dia 2+: só conta sem venda no dia.
  if (e.sales === 0) {
    return { saude: "atencao", motivo: "sem venda no dia", ruler: "amarelo" };
  }
  if (e.revenue_cents == null) {
    return { saude: "saudavel", motivo: "vendeu · preencher faturamento", ruler: "azul" };
  }
  return { saude: "saudavel", motivo: null, ruler: "azul" };
}

/**
 * Saúde do Criativo para a biblioteca (totais + Sinal do dia mais recente).
 * - Pausado/Encerrado: sempre vermelhos, sem avaliar.
 * - Sem movimento (pré-cadastro): sem Dia 1, sem Sinal (cinza).
 * - Ativo: azul (saudável) / amarelo (atenção).
 * - Escalando: selo manual — fica verde mesmo em atenção; a atenção aparece
 *   no marcador da régua (amarelo) + motivo, sem tirar o Escalando.
 */
export function evaluateCreative(status: CreativeStatus, entries: DayEntry[]): CreativeHealth {
  // Fonte única do Sinal: biblioteca = período total com Dia 1 global.
  return healthForPeriod(status, findDia1(entries), entries);
}

/**
 * Saúde no período do dashboard: mesmo Sinal, mas escopo do período.
 * - Usa o Dia 1 GLOBAL (para não redefinir Dia 1 a cada filtro).
 * - Avalia o dia com movimento mais recente DENTRO do período.
 * - Sem movimento no período → Sem dados (cinza), salvo Pausado/Encerrado (vermelho).
 */
export function healthForPeriod(
  status: CreativeStatus,
  globalDia1: string | null,
  periodEntries: DayEntry[],
): CreativeHealth {
  if (status === "pausado") {
    return { saude: null, statusDisplay: "Pausado", ruler: "vermelho", motivo: "ainda recebe vendas (cookie)", dia1: globalDia1 };
  }
  if (status === "encerrado") {
    return { saude: null, statusDisplay: "Encerrado", ruler: "vermelho", motivo: "histórico · sem lançamentos", dia1: globalDia1 };
  }
  if (globalDia1 == null) {
    return { saude: null, statusDisplay: "Sem dados", ruler: "cinza", motivo: null, dia1: null };
  }
  const withMovement = periodEntries.filter(hasMovement).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (withMovement.length === 0) {
    return { saude: null, statusDisplay: "Sem dados", ruler: "cinza", motivo: null, dia1: globalDia1 };
  }
  const latest = withMovement[withMovement.length - 1];
  const sig = evaluateDay(latest, latest.date === globalDia1);
  if (status === "escalando") {
    return {
      saude: sig.saude,
      statusDisplay: "Escalando",
      ruler: sig.saude === "atencao" ? "amarelo" : "verde",
      motivo: sig.motivo,
      dia1: globalDia1,
    };
  }
  return {
    saude: sig.saude,
    statusDisplay: sig.saude === "atencao" ? "Atenção" : "Saudável",
    ruler: sig.saude === "atencao" ? "amarelo" : "azul",
    motivo: sig.motivo,
    dia1: globalDia1,
  };
}

// ---------- Formato brasileiro (a tela mostra "—" no nulo) ----------

export function formatRoas(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

export function formatBRL(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function formatCPC(cents: number | null): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return formatBRL(cents);
}

export function formatNum(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ---------- Entrada do usuário (aceita "4,18" e "4.18") ----------

/** Moeda digitada → centavos (null = vazio). NaN = inválido. */
export function parseMoedaParaCentavos(str: string | null | undefined): number | null {
  if (str == null) return null;
  let s = String(str).trim();
  if (s === "") return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  if (!Number.isFinite(n)) return NaN as unknown as number;
  return Math.round(n * 100);
}

/** Inteiro digitado (vendas/cliques). null = vazio. */
export function parseInteiro(str: string | null | undefined): number | null {
  if (str == null) return null;
  const s = String(str).trim();
  if (s === "") return null;
  const n = Number(s.replace(",", "."));
  if (!Number.isFinite(n)) return NaN as unknown as number;
  return Math.round(n);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(`${s}T00:00:00Z`);
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d;
}
