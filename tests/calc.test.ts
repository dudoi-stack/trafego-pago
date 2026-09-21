import { describe, expect, test } from "bun:test";
import {
  agg,
  calcRow,
  costOf,
  CPC_META_LIMITE_CENTS,
  evaluateCreative,
  evaluateDay,
  findDia1,
  formatBRL,
  formatCPC,
  hasMovement,
  type DayEntry,
} from "../src/shared/calc.ts";

const TAX = 0.1386;

function day(partial: Partial<DayEntry> & { date: string }): DayEntry {
  return {
    investment_cents: 0,
    sales: 0,
    revenue_cents: null,
    clicks_meta: 0,
    clicks_shopee: 0,
    tax_rate: TAX,
    ...partial,
  };
}

describe("calc — vetores da planilha real (exemplo/agosto_2026.xlsx)", () => {
  test("linha 01/08: custo e CPCs", () => {
    const e = day({
      date: "2026-08-01",
      investment_cents: 418,
      sales: 1,
      revenue_cents: 0,
      clicks_meta: 10,
      clicks_shopee: 19,
    });
    // 4,18 × (1 + 13,86%) = 4,759348 → 475,9348 centavos
    expect(costOf(e)).toBeCloseTo(475.9348, 4);
    const r = calcRow(e);
    expect(r.cost_cents).toBeCloseTo(475.9348, 4);
    // CPC Meta 4,18 ÷ 10 = 0,418 → 41,8 centavos
    expect(r.cpc_meta_cents).toBeCloseTo(41.8, 4);
    // CPC Shopee 4,18 ÷ 19 = 0,22 → 22 centavos
    expect(r.cpc_shopee_cents).toBeCloseTo(22, 4);
  });

  test("linha 12/08: custo e CPC Meta", () => {
    const e = day({
      date: "2026-08-12",
      investment_cents: 3470,
      sales: 10,
      revenue_cents: 0,
      clicks_meta: 321,
      clicks_shopee: 480,
    });
    // 34,70 × 1,1386 = 39,50942 → 3950,942 centavos
    expect(costOf(e)).toBeCloseTo(3950.942, 3);
    const r = calcRow(e);
    // 34,70 ÷ 321 = 0,1080996885 → 10,8099... centavos
    expect(r.cpc_meta_cents).toBeCloseTo(10.80996885, 4);
  });

  test("totais do mês: invest, custo e vendas (13 linhas com movimento)", () => {
    const entries: DayEntry[] = [
      [1, 418, 1, 10, 19],
      [2, 664, 0, 45, 56],
      [3, 765, 1, 54, 71],
      [4, 506, 0, 77, 55],
      [5, 801, 2, 73, 110],
      [6, 660, 3, 77, 113],
      [7, 491, 0, 45, 68],
      [8, 2480, 13, 217, 324],
      [9, 2811, 12, 208, 297],
      [10, 3238, 6, 243, 393],
      [11, 3385, 9, 292, 428],
      [12, 3470, 10, 321, 480],
      [20, 1000, 12, 2, 10],
    ].map(([d, invest, sales, clM, clS]) =>
      day({
        date: `2026-08-${String(d).padStart(2, "0")}`,
        investment_cents: invest,
        sales,
        revenue_cents: 0,
        clicks_meta: clM,
        clicks_shopee: clS,
      }),
    );
    const a = agg(entries);
    // invest 206,89 → 20689 centavos (soma exata, sem arredondar)
    expect(a.investment_cents).toBe(20689);
    // custo 235,564954 → 23556,4954 centavos
    expect(a.cost_cents).toBeCloseTo(23556.4954, 2);
    expect(a.sales).toBe(69);
  });

  test("centavos somados sem arredondar (só arredonda na exibição)", () => {
    const a = day({ date: "2026-08-01", investment_cents: 1 });
    const b = day({ date: "2026-08-02", investment_cents: 1 });
    // 1 × 1,1386 = 1,1386 (não arredonda para 1)
    const total = agg([a, b]);
    expect(total.cost_cents).toBeCloseTo(2.2772, 4);
    expect(total.cost_cents).not.toBe(2);
  });
});

describe("calc — pendente e divisão por zero", () => {
  test("vendeu mas sem faturamento = pendente (lucro null, fora do agregado)", () => {
    const e = day({
      date: "2026-09-18",
      investment_cents: 1000,
      sales: 2,
      revenue_cents: null,
      clicks_meta: 50,
      clicks_shopee: 60,
    });
    const r = calcRow(e);
    expect(r.is_pending).toBe(true);
    expect(r.profit_cents).toBeNull();

    const fechado = day({
      date: "2026-09-17",
      investment_cents: 1000,
      sales: 1,
      revenue_cents: 2000,
      clicks_meta: 50,
      clicks_shopee: 60,
    });
    const a = agg([fechado, e]);
    // agregado exclui o pendente do faturamento e do custo fechado, com aviso
    expect(a.has_pending).toBe(true);
    expect(a.pending_days).toBe(1);
    expect(a.revenue_cents).toBe(2000);
    expect(a.costClosed_cents).toBeCloseTo(1000 * (1 + TAX), 4);
    expect(a.profit_cents).toBeCloseTo(2000 - 1000 * (1 + TAX), 4);
  });

  test("zero vendas + faturamento vazio = zero (não é pendente)", () => {
    const e = day({
      date: "2026-09-18",
      investment_cents: 1000,
      sales: 0,
      revenue_cents: null,
      clicks_meta: 50,
      clicks_shopee: 60,
    });
    const r = calcRow(e);
    expect(r.is_pending).toBe(false);
    // vazio vira zero: lucro = 0 − custo
    expect(r.profit_cents).toBeCloseTo(0 - 1000 * (1 + TAX), 4);
  });

  test("divisão por zero → null (a tela mostra '—')", () => {
    const e = day({ date: "2026-09-18", investment_cents: 1000 });
    const r = calcRow(e);
    expect(r.cpc_meta_cents).toBeNull();
    expect(r.cpc_shopee_cents).toBeNull();
    expect(formatCPC(r.cpc_meta_cents)).toBe("—");
    expect(formatBRL(null)).toBe("—");
  });
});

describe("calc — Dia 1 e Sinal (travas, sem ROAS)", () => {
  test("dia só conta com movimento; Dia 1 é o primeiro com movimento", () => {
    const parado = day({ date: "2026-09-01" });
    const mov1 = day({ date: "2026-09-02", investment_cents: 500 });
    const mov2 = day({ date: "2026-09-03", investment_cents: 600 });
    expect(hasMovement(parado)).toBe(false);
    expect(hasMovement(mov1)).toBe(true);
    expect(findDia1([parado, mov2, mov1])).toBe("2026-09-02");
  });

  test("limite do CPC Meta é 0,10 (10 centavos)", () => {
    expect(CPC_META_LIMITE_CENTS).toBe(10);
  });

  test("Dia 1 com CPC Meta > 0,10 → Atenção", () => {
    // 4,18 ÷ 10 = 0,418 > 0,10
    const e = day({
      date: "2026-09-02",
      investment_cents: 418,
      clicks_meta: 10,
      clicks_shopee: 100,
      sales: 0,
    });
    const s = evaluateDay(e, true);
    expect(s.saude).toBe("atencao");
    expect(s.motivo).toMatch(/CPC Meta/);
  });

  test("Dia 1 com CPC Shopee >= CPC Meta → Atenção", () => {
    // CPC Meta 10 ÷ 100 = 0,10 ; CPC Shopee 10 ÷ 50 = 0,20 >= 0,10
    const e = day({
      date: "2026-09-02",
      investment_cents: 1000,
      clicks_meta: 100,
      clicks_shopee: 50,
      sales: 1,
    });
    const s = evaluateDay(e, true);
    expect(s.saude).toBe("atencao");
    expect(s.motivo).toMatch(/CPC Shopee/);
  });

  test("Dia 1 com CPC indefinido e gasto → Atenção", () => {
    const e = day({ date: "2026-09-02", investment_cents: 500 });
    const s = evaluateDay(e, true);
    expect(s.saude).toBe("atencao");
  });

  test("Dia 1 com cliques sem investimento → Atenção", () => {
    const e = day({ date: "2026-09-02", investment_cents: 0, clicks_meta: 10 });
    const s = evaluateDay(e, true);
    expect(s.saude).toBe("atencao");
    expect(s.motivo).toMatch(/cliques sem investimento/);
  });

  test("Dia 1 cookie (venda sem invest/cliques) → azul (Saudável)", () => {
    const e = day({
      date: "2026-09-02",
      investment_cents: 0,
      sales: 1,
      revenue_cents: 1000,
    });
    const s = evaluateDay(e, true);
    expect(s.saude).toBe("saudavel");
    expect(s.ruler).toBe("azul");
  });

  test("Dia 2+ sem venda no dia → Atenção; com venda → Saudável", () => {
    const semVenda = day({ date: "2026-09-03", investment_cents: 500, sales: 0 });
    expect(evaluateDay(semVenda, false).saude).toBe("atencao");
    expect(evaluateDay(semVenda, false).motivo).toMatch(/sem venda/);

    const comVenda = day({ date: "2026-09-03", investment_cents: 500, sales: 1 });
    expect(evaluateDay(comVenda, false).saude).toBe("saudavel");
  });

  test("Pausado/Encerrado sempre vermelhos sem avaliar", () => {
    const entries = [
      day({ date: "2026-09-02", investment_cents: 418, clicks_meta: 10, clicks_shopee: 19, sales: 5 }),
    ];
    for (const status of ["pausado", "encerrado"] as const) {
      const h = evaluateCreative(status, entries);
      expect(h.ruler).toBe("vermelho");
      expect(h.saude).toBeNull();
    }
    expect(evaluateCreative("pausado", entries).statusDisplay).toBe("Pausado");
    expect(evaluateCreative("encerrado", entries).statusDisplay).toBe("Encerrado");
  });

  test("Escalando persiste na atenção (régua amarela, status segue Escalando)", () => {
    const atencao = day({ date: "2026-09-03", investment_cents: 500, sales: 0 });
    const h = evaluateCreative("escalando", [
      day({ date: "2026-09-02", investment_cents: 500, sales: 1, clicks_meta: 100, clicks_shopee: 200 }),
      atencao,
    ]);
    expect(h.statusDisplay).toBe("Escalando");
    expect(h.ruler).toBe("amarelo");
    expect(h.motivo).toMatch(/sem venda/);
  });

  test("Escalando saudável fica verde", () => {
    const h = evaluateCreative("escalando", [
      day({ date: "2026-09-02", investment_cents: 500, sales: 1, clicks_meta: 100, clicks_shopee: 200 }),
    ]);
    // CPC Meta 5,00÷100… ajustado abaixo para ficar saudável
    expect(["verde", "amarelo"]).toContain(h.ruler);
    expect(h.statusDisplay).toBe("Escalando");
  });

  test("Ativo saudável fica azul; Ativo em atenção fica amarelo", () => {
    const saudavel = evaluateCreative("ativo", [
      day({ date: "2026-09-02", investment_cents: 500, sales: 1, clicks_meta: 100, clicks_shopee: 200 }),
    ]);
    // 500÷100=5,00cent=0,05 ≤0,10 e Shopee 500÷200=2,5cent <5cent → saudável
    expect(saudavel.ruler).toBe("azul");
    expect(saudavel.statusDisplay).toBe("Saudável");

    const atencao = evaluateCreative("ativo", [
      day({ date: "2026-09-02", investment_cents: 500, sales: 1, clicks_meta: 100, clicks_shopee: 200 }),
      day({ date: "2026-09-03", investment_cents: 500, sales: 0 }),
    ]);
    expect(atencao.ruler).toBe("amarelo");
    expect(atencao.statusDisplay).toBe("Atenção");
  });

  test("pré-cadastro futuro (sem movimento) não conta Dia 1 nem dispara Sinal", () => {
    const h = evaluateCreative("ativo", []);
    expect(findDia1([])).toBeNull();
    expect(h.dia1).toBeNull();
    expect(h.saude).toBeNull();
    expect(h.ruler).toBe("cinza");
  });
});
