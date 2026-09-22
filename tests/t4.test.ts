import { afterEach, describe, expect, test } from "./support/parity.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/app.ts";
import { agg, type DayEntry } from "../src/shared/calc.ts";

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
  const dataDir = await mkdtemp(join(tmpdir(), "gestor-t4-"));
  dirs.push(dataDir);
  const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
  servers.push(server);
  return server;
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

async function patchCreative(port: number, id: number, body: Record<string, unknown>) {
  const res = await fetch(`http://127.0.0.1:${port}/api/creatives/${id}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { data?: any; error?: string; warnings?: string[] };
  return { res, json };
}

describe("T4 — GET /api/creatives/:id/entries (detalhe réplica-da-planilha)", () => {
  test("lista dias com colunas calculadas + TOTAL bate com o agregado + saúde", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Detalhe T4 01", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, c.id, "2026-09-01", {
      investment_cents: 418,
      sales: 1,
      revenue_cents: 1000,
      clicks_meta: 10,
      clicks_shopee: 19,
    });
    await putEntry(server.port, c.id, "2026-09-02", {
      investment_cents: 500,
      sales: 0,
      revenue_cents: null,
      clicks_meta: 20,
      clicks_shopee: 30,
    });

    const res = await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        creative: any;
        entries: any[];
        totals: any;
        health: any;
        months: string[];
        dia1: string | null;
      };
      warnings: string[];
    };
    expect(body.data.entries).toHaveLength(2);
    // Mais recentes no topo
    expect(body.data.entries[0].date).toBe("2026-09-02");
    // Colunas digitáveis presentes
    expect(body.data.entries[0]).toMatchObject({ investment_cents: 500, sales: 0 });
    // Colunas calculadas presentes (custo, lucro, CPCs)
    expect(typeof body.data.entries[0].cost_cents).toBe("number");
    expect(body.data.entries[0].cpc_meta_cents).not.toBeUndefined();
    expect(body.data.entries[0].cpc_shopee_cents).not.toBeUndefined();
    expect(body.data.entries[0].profit_cents).not.toBeUndefined();
    // Sinal por dia presente
    expect(body.data.entries[0].signal).toBeDefined();
    // Dia 1 global
    expect(body.data.dia1).toBe("2026-09-01");
    expect(body.data.entries.find((e) => e.date === "2026-09-01")?.is_dia1).toBe(true);
    // TOTAL bate com o agregado (módulo único)
    const asDay: DayEntry[] = body.data.entries.map((e) => ({
      date: e.date,
      investment_cents: e.investment_cents,
      sales: e.sales,
      revenue_cents: e.revenue_cents,
      clicks_meta: e.clicks_meta,
      clicks_shopee: e.clicks_shopee,
      tax_rate: e.tax_rate,
    }));
    const a = agg(asDay);
    expect(body.data.totals.investment_cents).toBe(a.investment_cents);
    expect(body.data.totals.cost_cents).toBeCloseTo(a.cost_cents, 4);
    expect(body.data.totals.sales).toBe(a.sales);
    // Bate com a biblioteca (/api/creatives/:id)
    const one = (await (await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}`)).json()) as {
      data: any;
    };
    expect(body.data.totals.investment_cents).toBe(one.data.totals.investment_cents);
    expect(body.data.health.ruler).toBe(one.data.health.ruler);
    expect(body.data.health.statusDisplay).toBe(one.data.health.statusDisplay);
    // Meses disponíveis
    expect(body.data.months).toContain("2026-09");
  });

  test("filtro por mês (?month=AAAA-MM) + TOTAL do filtro", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Detalhe T4 02", start_date: "2026-08-01" })).json.data;
    await putEntry(server.port, c.id, "2026-08-01", {
      investment_cents: 418,
      sales: 1,
      revenue_cents: 1000,
      clicks_meta: 10,
      clicks_shopee: 19,
    });
    await putEntry(server.port, c.id, "2026-09-01", {
      investment_cents: 600,
      sales: 2,
      revenue_cents: 2000,
      clicks_meta: 11,
      clicks_shopee: 20,
    });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries?month=2026-08`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { entries: any[]; totals: any } };
    expect(body.data.entries).toHaveLength(1);
    expect(body.data.entries[0].date).toBe("2026-08-01");
    expect(body.data.totals.investment_cents).toBe(418);
    const bad = await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries?month=20-08`);
    expect(bad.status).toBe(400);
  });

  test("404 para criativo inexistente", async () => {
    const server = await boot();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/creatives/99999/entries`);
    expect(res.status).toBe(404);
  });
});

describe("T4 — PATCH /api/creatives/:id (pausar/encerrar/reabrir/escalar)", () => {
  test("pausar fica vermelho sem avaliar; encerrar não apaga lançamentos", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Ciclo 01", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, c.id, "2026-09-01", {
      investment_cents: 500,
      sales: 1,
      revenue_cents: 2000,
      clicks_meta: 100,
      clicks_shopee: 200,
    });
    const pau = await patchCreative(server.port, c.id, { status: "pausado" });
    expect(pau.res.status).toBe(200);
    expect(pau.json.data.status).toBe("pausado");
    expect(pau.json.data.health.ruler).toBe("vermelho");
    expect(pau.json.data.health.statusDisplay).toBe("Pausado");
    expect(pau.json.data.health.saude).toBeNull();

    const enc = await patchCreative(server.port, c.id, { status: "encerrado" });
    expect(enc.res.status).toBe(200);
    expect(enc.json.data.health.ruler).toBe("vermelho");
    expect(enc.json.data.health.statusDisplay).toBe("Encerrado");
    // Não apagou lançamentos: detalhe ainda tem o dia
    const det = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}/entries`)
    ).json()) as { data: { entries: any[]; totals: any } };
    expect(det.data.entries).toHaveLength(1);
    expect(det.data.totals.investment_cents).toBe(500);
  });

  test("reabrir libera lançamentos; encerrado bloqueia, pausado recebe", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Ciclo 02", start_date: "2026-09-01" })).json.data;
    await patchCreative(server.port, c.id, { status: "encerrado" });
    const blocked = await putEntry(server.port, c.id, "2026-09-02", {
      investment_cents: 100,
      sales: 0,
      clicks_meta: 0,
      clicks_shopee: 0,
    });
    expect(blocked.res.status).toBe(400);
    expect(blocked.json.error).toBe("encerrado_sem_lancamento");

    const reabrir = await patchCreative(server.port, c.id, { status: "ativo" });
    expect(reabrir.res.status).toBe(200);
    expect(reabrir.json.data.status).toBe("ativo");
    const ok = await putEntry(server.port, c.id, "2026-09-02", {
      investment_cents: 100,
      sales: 0,
      clicks_meta: 5,
      clicks_shopee: 10,
    });
    expect(ok.res.status).toBe(200);

    await patchCreative(server.port, c.id, { status: "pausado" });
    const cookie = await putEntry(server.port, c.id, "2026-09-03", {
      investment_cents: 0,
      sales: 1,
      revenue_cents: 900,
      clicks_meta: 0,
      clicks_shopee: 0,
    });
    expect(cookie.res.status).toBe(200);
  });

  test("escalar só vem do ativo; desmarcar volta ao sinal; persiste na atenção", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Ciclo 03", start_date: "2026-09-01" })).json.data;
    await putEntry(server.port, c.id, "2026-09-01", {
      investment_cents: 500,
      sales: 1,
      revenue_cents: 2000,
      clicks_meta: 100,
      clicks_shopee: 200,
    });
    const esc = await patchCreative(server.port, c.id, { status: "escalando" });
    expect(esc.res.status).toBe(200);
    expect(esc.json.data.health.statusDisplay).toBe("Escalando");
    expect(esc.json.data.health.ruler).toBe("verde");

    // Dia 2 sem venda → atenção vai para régua + motivo, status segue Escalando
    await putEntry(server.port, c.id, "2026-09-02", {
      investment_cents: 500,
      sales: 0,
      clicks_meta: 10,
      clicks_shopee: 10,
    });
    const after = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives/${c.id}`)
    ).json()) as { data: any };
    expect(after.data.health.statusDisplay).toBe("Escalando");
    expect(after.data.health.ruler).toBe("amarelo");
    expect(after.data.health.motivo).toMatch(/sem venda/);

    // Desmarcar sem pausar volta ao sinal calculado (atenção → amarelo/Atenção)
    const des = await patchCreative(server.port, c.id, { status: "ativo" });
    expect(des.res.status).toBe(200);
    expect(des.json.data.health.statusDisplay).toBe("Atenção");
    expect(des.json.data.health.ruler).toBe("amarelo");
  });

  test("escalar do pausado/encerrado é recusado", async () => {
    const server = await boot();
    const c = (await criar(server.port, { name: "Ciclo 04", start_date: "2026-09-01", status: "pausado" })).json.data;
    const esc = await patchCreative(server.port, c.id, { status: "escalando" });
    expect(esc.res.status).toBe(400);
    const e2 = (await criar(server.port, { name: "Ciclo 05", start_date: "2026-09-01", status: "encerrado" })).json.data;
    const esc2 = await patchCreative(server.port, e2.id, { status: "escalando" });
    expect(esc2.res.status).toBe(400);
  });

  test("nome único continua valendo na edição; validações de formato/data/status", async () => {
    const server = await boot();
    const a = (await criar(server.port, { name: "Nome A", start_date: "2026-09-01" })).json.data;
    const b = (await criar(server.port, { name: "Nome B", start_date: "2026-09-01" })).json.data;
    const dup = await patchCreative(server.port, b.id, { name: "nome a" });
    expect(dup.res.status).toBe(409);
    expect(dup.json.error).toBe("nome_duplicado");
    const badFormat = await patchCreative(server.port, a.id, { format: "stories" });
    expect(badFormat.res.status).toBe(400);
    const badStatus = await patchCreative(server.port, a.id, { status: "testando" });
    expect(badStatus.res.status).toBe(400);
    const badDate = await patchCreative(server.port, a.id, { start_date: "01/09/2026" });
    expect(badDate.res.status).toBe(400);
    const missing = await patchCreative(server.port, 99999, { status: "ativo" });
    expect(missing.res.status).toBe(404);
  });
});
