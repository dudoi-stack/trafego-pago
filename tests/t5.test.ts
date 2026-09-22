import { afterEach, describe, expect, test } from "./support/parity.ts";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/app.ts";
import { agg } from "../src/shared/calc.ts";

let dirs: string[] = [];
let servers: { stop: () => void }[] = [];

afterEach(async () => {
  for (const s of servers) {
    try {
      s.stop();
    } catch {
      // ignore
    }
  }
  servers = [];
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
  dirs = [];
});

async function boot() {
  const dataDir = await mkdtemp(join(tmpdir(), "gestor-t5-"));
  dirs.push(dataDir);
  const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
  servers.push(server);
  return { server, dataDir };
}

async function criar(port: number, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/api/creatives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: any; error?: string; warnings?: string[] };
  return { res, json };
}

async function putEntry(port: number, id: number, date: string, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/api/creatives/${id}/entries/${date}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: any; error?: string; warnings?: string[] };
  return { res, json };
}

async function dash(port: number, qs: string) {
  const res = await fetch(`http://127.0.0.1:${port}/api/dashboard${qs}`);
  const json = (await res.json()) as { data?: any; error?: string; warnings?: string[] };
  return { res, json };
}

describe("T5 — calc ROAS-equivalente (módulo único)", () => {
  test("agg expõe faturamento ÷ custo fechado; null sem custo fechado", async () => {
    const a = agg([
      { date: "2026-09-01", investment_cents: 418, sales: 1, revenue_cents: 1000, clicks_meta: 10, clicks_shopee: 19, tax_rate: 0.1386 },
      { date: "2026-09-02", investment_cents: 500, sales: 2, revenue_cents: 2000, clicks_meta: 20, clicks_shopee: 30, tax_rate: 0.1386 },
    ]);
    expect(a.roas_equivalente).toBeCloseTo(3000 / a.costClosed_cents, 6);
    const pend = agg([
      { date: "2026-09-01", investment_cents: 500, sales: 1, revenue_cents: null, clicks_meta: 10, clicks_shopee: 10, tax_rate: 0.1386 },
    ]);
    expect(pend.roas_equivalente).toBeNull();
    expect(pend.profit_cents).toBeNull();
  });
});

describe("T5 — biblioteca ordenável (lucro/ROAS/custo/vendas)", () => {
  test("totals trazem roas_equivalente + ?sort ordena", async () => {
    const { server } = await boot();
    const a = (await criar(server.port, { name: "Sort A", start_date: "2026-09-01" })).json.data;
    const b = (await criar(server.port, { name: "Sort B", start_date: "2026-09-01" })).json.data;
    const c = (await criar(server.port, { name: "Sort C", start_date: "2026-09-01" })).json.data;
    // A: lucro alto; B: médio; C: prejuízo
    await putEntry(server.port, a.id, "2026-09-01", { investment_cents: 500, sales: 5, revenue_cents: 5000, clicks_meta: 100, clicks_shopee: 200 });
    await putEntry(server.port, b.id, "2026-09-01", { investment_cents: 500, sales: 1, revenue_cents: 1000, clicks_meta: 100, clicks_shopee: 200 });
    await putEntry(server.port, c.id, "2026-09-01", { investment_cents: 1000, sales: 0, revenue_cents: null, clicks_meta: 50, clicks_shopee: 60 });

    const base = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives`)).json()) as { data: any[] };
    expect(base.data[0].totals.roas_equivalente).toBeDefined();

    const byProfit = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?sort=profit`)).json()) as { data: any[] };
    expect(byProfit.data.map((x) => x.name)).toEqual(["Sort A", "Sort B", "Sort C"]);

    const bySales = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?sort=sales`)).json()) as { data: any[] };
    expect(bySales.data[0].name).toBe("Sort A");

    const byCost = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?sort=cost`)).json()) as { data: any[] };
    expect(byCost.data[0].name).toBe("Sort C");

    const byRoas = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?sort=roas`)).json()) as { data: any[] };
    expect(byRoas.data[0].name).toBe("Sort A");
    // C sem custo fechado (zero venda + vazio tem custo fechado, mas lucro negativo → roas 0)
    expect(byRoas.data.map((x) => x.name)).toContain("Sort C");
  });
});

describe("T5 — GET /api/dashboard", () => {
  test("totais + período anterior (mesmo tamanho, imediatamente antes) + série diária", async () => {
    const { server } = await boot();
    const a = (await criar(server.port, { name: "Dash A", product: "P1", start_date: "2026-09-01" })).json.data;
    const b = (await criar(server.port, { name: "Dash B", product: "P2", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, a.id, "2026-09-10", { investment_cents: 1000, sales: 2, revenue_cents: 3000, clicks_meta: 100, clicks_shopee: 200 });
    await putEntry(server.port, b.id, "2026-09-11", { investment_cents: 500, sales: 1, revenue_cents: 1000, clicks_meta: 100, clicks_shopee: 200 });
    await putEntry(server.port, a.id, "2026-09-01", { investment_cents: 200, sales: 0, revenue_cents: null, clicks_meta: 10, clicks_shopee: 10 });

    const { res, json } = await dash(server.port, "?from=2026-09-10&to=2026-09-11");
    expect(res.status).toBe(200);
    const d = json.data;
    expect(d.period).toEqual({ from: "2026-09-10", to: "2026-09-11" });
    expect(d.previousPeriod).toEqual({ from: "2026-09-08", to: "2026-09-09" });
    expect(d.totals.investment_cents).toBe(1500);
    expect(d.totals.sales).toBe(3);
    expect(d.previousTotals).toBeDefined();
    expect(d.daily).toHaveLength(2);
    expect(d.daily[0].date).toBe("2026-09-10");
    expect(typeof d.daily[0].cost_cents).toBe("number");
    expect(d.creatives).toHaveLength(2);
    // Tabela ordenada por lucro desc por padrão
    expect(d.creatives[0].totals.profit_cents).toBeGreaterThanOrEqual(d.creatives[1].totals.profit_cents ?? -Infinity);
    // Totais batem com o módulo único
    const asDays = [
      { date: "2026-09-10", investment_cents: 1000, sales: 2, revenue_cents: 3000, clicks_meta: 100, clicks_shopee: 200, tax_rate: 0.1386 },
      { date: "2026-09-11", investment_cents: 500, sales: 1, revenue_cents: 1000, clicks_meta: 100, clicks_shopee: 200, tax_rate: 0.1386 },
    ];
    const ref = agg(asDays as any);
    expect(d.totals.investment_cents).toBe(ref.investment_cents);
    expect(d.totals.cost_cents).toBeCloseTo(ref.cost_cents, 4);
  });

  test("filtros: criativos, status, produto e decisão", async () => {
    const { server } = await boot();
    const a = (await criar(server.port, { name: "F A", product: "PA", start_date: "2026-09-01", status: "ativo" })).json.data;
    const b = (await criar(server.port, { name: "F B", product: "PB", start_date: "2026-09-01", status: "pausado" })).json.data;
    await putEntry(server.port, a.id, "2026-09-10", { investment_cents: 500, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 });
    await putEntry(server.port, b.id, "2026-09-10", { investment_cents: 500, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 });

    const onlyA = (await dash(server.port, `?from=2026-09-10&to=2026-09-10&creatives=${a.id}`)).json.data;
    expect(onlyA.creatives).toHaveLength(1);
    expect(onlyA.creatives[0].creative.name).toBe("F A");

    const paus = (await dash(server.port, "?from=2026-09-10&to=2026-09-10&status=pausado")).json.data;
    expect(paus.creatives.every((c: any) => c.creative.status === "pausado")).toBe(true);

    const prod = (await dash(server.port, "?from=2026-09-10&to=2026-09-10&product=PA")).json.data;
    expect(prod.creatives).toHaveLength(1);

    const dec = (await dash(server.port, "?from=2026-09-10&to=2026-09-10&decision=pausado")).json.data;
    expect(dec.creatives.every((c: any) => c.health.statusDisplay === "Pausado")).toBe(true);

    const bad = await dash(server.port, "?from=20/09/2026&to=2026-09-10");
    expect(bad.res.status).toBe(400);
  });

  test("aviso de pendentes + faixa nos dias pendentes", async () => {
    const { server } = await boot();
    const a = (await criar(server.port, { name: "Pend D", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, a.id, "2026-09-10", { investment_cents: 1000, sales: 2, revenue_cents: null, clicks_meta: 50, clicks_shopee: 60 });
    const { json } = await dash(server.port, "?from=2026-09-10&to=2026-09-10");
    expect(json.data.totals.has_pending).toBe(true);
    expect((json.warnings ?? []).join(" ").toLowerCase()).toMatch(/pendente/);
    expect(json.data.daily[0].pending).toBe(true);
    expect(json.data.daily[0].profit_cents).toBeNull();
  });

  test("previousPeriod tem o mesmo tamanho e vem imediatamente antes", async () => {
    const { server } = await boot();
    const a = (await criar(server.port, { name: "Prev 01", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, a.id, "2026-09-05", { investment_cents: 300, sales: 1, revenue_cents: 1000, clicks_meta: 50, clicks_shopee: 100 });
    await putEntry(server.port, a.id, "2026-09-10", { investment_cents: 700, sales: 0, revenue_cents: null, clicks_meta: 20, clicks_shopee: 20 });
    const { json } = await dash(server.port, "?from=2026-09-10&to=2026-09-12");
    expect(json.data.previousPeriod).toEqual({ from: "2026-09-07", to: "2026-09-09" });
    expect(json.data.previousTotals).toBeDefined();
  });
});

describe("T5 — imposto editável (dias antigos intactos)", () => {
  test("GET padrão 13,86% · PUT atualiza · dias antigos intactos", async () => {
    const { server } = await boot();
    const get0 = await (await fetch(`http://127.0.0.1:${server.port}/api/settings`)).json() as { data: any };
    expect(get0.data.tax_rate).toBeCloseTo(0.1386, 4);

    const put = await fetch(`http://127.0.0.1:${server.port}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tax_rate: 0.2 }),
    });
    expect(put.status).toBe(200);
    const putJson = (await put.json()) as { data: any };
    expect(putJson.data.tax_rate).toBeCloseTo(0.2, 4);

    const c = (await criar(server.port, { name: "Imp 01", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, c.id, "2026-09-01", { investment_cents: 1000, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 });
    // Muda de novo: dia antigo deve manter 0.2
    await fetch(`http://127.0.0.1:${server.port}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tax_rate: "10" }),
    });
    // Re-salva o mesmo dia (upsert preserva a taxa do dia)
    await putEntry(server.port, c.id, "2026-09-01", { investment_cents: 1000, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 });
    const det = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries`)).json()) as {
      data: { entries: any[] };
    };
    expect(det.data.entries[0].tax_rate).toBeCloseTo(0.2, 4);
    // Dia novo usa a taxa nova (10%)
    await putEntry(server.port, c.id, "2026-09-02", { investment_cents: 1000, sales: 0, clicks_meta: 10, clicks_shopee: 10 });
    const det2 = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries`)).json()) as {
      data: { entries: any[] };
    };
    const day2 = det2.data.entries.find((e) => e.date === "2026-09-02");
    expect(day2.tax_rate).toBeCloseTo(0.1, 4);

    const bad = await fetch(`http://127.0.0.1:${server.port}/api/settings`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tax_rate: -5 }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("T5 — backup + export + caminho visível", () => {
  test("POST /api/backup cria arquivo · GET /api/backups lista · GET /api/export · GET /api/info", async () => {
    const { server, dataDir } = await boot();
    const c = (await criar(server.port, { name: "Bk 01", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, c.id, "2026-09-01", { investment_cents: 500, sales: 1, revenue_cents: 1000, clicks_meta: 10, clicks_shopee: 20 });

    const bk = await fetch(`http://127.0.0.1:${server.port}/api/backup`, { method: "POST" });
    expect(bk.status).toBe(201);
    const bkJson = (await bk.json()) as { data: { file: string; path: string; kept: number } };
    expect(bkJson.data.file).toMatch(/^gestor-.*\.db$/);

    const list = (await (await fetch(`http://127.0.0.1:${server.port}/api/backups`)).json()) as { data: any[] };
    expect(list.data.length).toBeGreaterThanOrEqual(1);

    const exp = (await (await fetch(`http://127.0.0.1:${server.port}/api/export`)).json()) as {
      data: { creatives: any[]; entries: any[] };
    };
    expect(exp.data.creatives.length).toBeGreaterThanOrEqual(1);
    expect(exp.data.entries.length).toBeGreaterThanOrEqual(1);

    const info = (await (await fetch(`http://127.0.0.1:${server.port}/api/info`)).json()) as {
      data: { dbPath: string; dataDir: string };
    };
    expect(info.data.dbPath).toContain("gestor.db");
    expect(info.data.dataDir).toBe(dataDir);

    const files = await readdir(join(dataDir, "backups"));
    expect(files.length).toBeGreaterThanOrEqual(1);
  });

  test("backups diários: boot não duplica no mesmo dia; prune mantém 30", async () => {
    const { server, dataDir } = await boot();
    // Segundo boot no mesmo dataDir não deve criar outro backup do mesmo dia
    const before = await readdir(join(dataDir, "backups"));
    server.stop();
    const s2 = await startServer({ host: "127.0.0.1", port: 0, dataDir });
    servers.push(s2);
    const after = await readdir(join(dataDir, "backups"));
    expect(after.length).toBe(before.length);

    // Prune: cria 35 arquivos falsos + chama backup via API até passar de 30
    const { join: pjoin } = await import("node:path");
    const { writeFile } = await import("node:fs/promises");
    for (let i = 0; i < 35; i += 1) {
      const name = `gestor-2026-01-${String(i + 1).padStart(2, "0")}-000000.db`;
      await writeFile(pjoin(dataDir, "backups", name), "x");
    }
    await fetch(`http://127.0.0.1:${s2.port}/api/backup`, { method: "POST" });
    const final = await readdir(join(dataDir, "backups"));
    expect(final.length).toBeLessThanOrEqual(30);
  });
});
