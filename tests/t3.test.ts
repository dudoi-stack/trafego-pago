import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../src/server/app.ts";

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
  const dataDir = await mkdtemp(join(tmpdir(), "gestor-t3-"));
  dirs.push(dataDir);
  const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
  servers.push(server);
  return server;
}

async function post(path: string, port: number, body: unknown) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as {
    data?: any;
    warnings?: string[];
    error?: string;
    duplicates?: string[];
  };
  return { res, json };
}

describe("T3 — POST /api/creatives/bulk (cadastro em lote)", () => {
  test("cadastra vários de uma vez com campos comuns", async () => {
    const server = await boot();
    const { res, json } = await post("/api/creatives/bulk", server.port, {
      names: ["Lote A 01", "Lote A 02", "Lote A 03"],
      product: "Mini processador",
      format: "video",
      start_date: "2026-09-20",
      status: "ativo",
    });
    expect(res.status).toBe(201);
    expect(json.data).toHaveLength(3);
    expect(json.warnings).toEqual([]);
    const list = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`)
    ).json()) as { data: any[] };
    expect(list.data).toHaveLength(3);
  });

  test("linhas vazias ignoradas; exige ao menos um nome", async () => {
    const server = await boot();
    const ok = await post("/api/creatives/bulk", server.port, {
      names: ["  Lote B 01  ", "", "   ", "Lote B 02"],
      start_date: "2026-09-20",
    });
    expect(ok.res.status).toBe(201);
    expect(ok.json.data.map((c: any) => c.name)).toEqual(["Lote B 01", "Lote B 02"]);

    const vazio = await post("/api/creatives/bulk", server.port, {
      names: ["", "   "],
      start_date: "2026-09-20",
    });
    expect(vazio.res.status).toBe(400);
    expect(vazio.json.error).toBe("nome_obrigatorio");
  });

  test("duplicado intra-lote recusa tudo (tudo-ou-nada)", async () => {
    const server = await boot();
    const { res, json } = await post("/api/creatives/bulk", server.port, {
      names: ["Dup 01", "dup 01", "Dup 02"],
      start_date: "2026-09-20",
    });
    expect(res.status).toBe(409);
    expect(json.error).toBe("nome_duplicado");
    expect(json.warnings?.length).toBeGreaterThan(0);
    const list = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`)
    ).json()) as { data: any[] };
    expect(list.data).toHaveLength(0);
  });

  test("duplicado contra base recusa tudo (case-insensitive, tudo-ou-nada)", async () => {
    const server = await boot();
    await post("/api/creatives", server.port, {
      name: "Base 01",
      start_date: "2026-09-20",
    });
    const { res, json } = await post("/api/creatives/bulk", server.port, {
      names: ["BASE 01", "Base 02"],
      start_date: "2026-09-20",
    });
    expect(res.status).toBe(409);
    expect(json.error).toBe("nome_duplicado");
    const list = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`)
    ).json()) as { data: any[] };
    expect(list.data).toHaveLength(1);
  });

  test("Encerrado libera o nome no lote", async () => {
    const server = await boot();
    await post("/api/creatives", server.port, {
      name: "Reuso Lote",
      start_date: "2026-09-20",
      status: "encerrado",
    });
    const { res } = await post("/api/creatives/bulk", server.port, {
      names: ["reuso lote"],
      start_date: "2026-09-20",
      status: "ativo",
    });
    expect(res.status).toBe(201);
  });

  test("validações do lote: formato, status e data", async () => {
    const server = await boot();
    const f = await post("/api/creatives/bulk", server.port, {
      names: ["X1"],
      format: "stories",
      start_date: "2026-09-20",
    });
    expect(f.res.status).toBe(400);
    const s = await post("/api/creatives/bulk", server.port, {
      names: ["X2"],
      status: "testando",
      start_date: "2026-09-20",
    });
    expect(s.res.status).toBe(400);
    const d = await post("/api/creatives/bulk", server.port, {
      names: ["X3"],
      start_date: "20/09/2026",
    });
    expect(d.res.status).toBe(400);
  });
});

describe("T3 — GET /api/entries?date (dia inteiro) + POST /api/entries/bulk", () => {
  async function criar(port: number, body: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${port}/api/creatives`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: any };
    return json.data;
  }

  async function bulkEntries(port: number, body: unknown) {
    const res = await fetch(`http://127.0.0.1:${port}/api/entries/bulk`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as {
      data?: any[];
      warnings?: string[];
      error?: string;
    };
    return { res, json };
  }

  test("dia lista só Ativos (ativo+escalando); exige data válida", async () => {
    const server = await boot();
    await criar(server.port, { name: "A1", start_date: "2026-09-20", status: "ativo" });
    await criar(server.port, { name: "E1", start_date: "2026-09-20", status: "escalando" });
    await criar(server.port, { name: "P1", start_date: "2026-09-20", status: "pausado" });
    await criar(server.port, { name: "X1", start_date: "2026-09-20", status: "encerrado" });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/entries?date=2026-09-20`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { date: string; data: any[] };
    expect(body.date).toBe("2026-09-20");
    const names = body.data.map((r) => r.creative.name).sort();
    expect(names).toEqual(["A1", "E1"]);
    expect(body.data[0].entry).toBeNull();

    const ruim = await fetch(`http://127.0.0.1:${server.port}/api/entries?date=20/09/2026`);
    expect(ruim.status).toBe(400);
  });

  test("bulk salva o dia de vários de uma vez (upsert por data)", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "D1", start_date: "2026-09-20" });
    const b = await criar(server.port, { name: "D2", start_date: "2026-09-20" });
    const { res, json } = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [
        { creative_id: a.id, investment_cents: 418, sales: 1, revenue_cents: 1000, clicks_meta: 10, clicks_shopee: 19 },
        { creative_id: b.id, investment_cents: 500, sales: 0, revenue_cents: null, clicks_meta: 20, clicks_shopee: 30 },
      ],
    });
    expect(res.status).toBe(200);
    expect(json.data).toHaveLength(2);
    const again = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 600, sales: 2, revenue_cents: 2000, clicks_meta: 11, clicks_shopee: 20 }],
    });
    expect(again.res.status).toBe(200);
    const day = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/entries?date=2026-09-20`)
    ).json()) as { data: any[] };
    const row = day.data.find((r) => r.creative.id === a.id);
    expect(row.entry.investment_cents).toBe(600);
    expect(row.entry.sales).toBe(2);
  });

  test("faturamento vazio com vendas = pendente (NULL, fora do lucro, com aviso)", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "Pendente 01", start_date: "2026-09-20" });
    const { res, json } = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 1000, sales: 2, revenue_cents: null, clicks_meta: 50, clicks_shopee: 60 }],
    });
    expect(res.status).toBe(200);
    expect(json.warnings?.join(" ").toLowerCase()).toMatch(/pendente/);
    const day = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/entries?date=2026-09-20`)
    ).json()) as { data: any[] };
    expect(day.data[0].entry.revenue_cents).toBeNull();
    const list = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`)
    ).json()) as { data: any[] };
    expect(list.data[0].totals.has_pending).toBe(true);
    expect(list.data[0].totals.profit_cents).toBeNull();
  });

  test("zero vendas + vazio = zero (não é pendente, sem aviso)", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "Zero 01", start_date: "2026-09-20" });
    const { res, json } = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 1000, sales: 0, revenue_cents: null, clicks_meta: 50, clicks_shopee: 60 }],
    });
    expect(res.status).toBe(200);
    expect((json.warnings ?? []).join(" ").toLowerCase()).not.toMatch(/pendente/);
    const list = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`)
    ).json()) as { data: any[] };
    expect(list.data[0].totals.has_pending).toBe(false);
    expect(list.data[0].totals.profit_cents).not.toBeNull();
  });

  test("tudo-ou-nada: um lançamento inválido recusa o lote inteiro", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "T1", start_date: "2026-09-20" });
    const b = await criar(server.port, { name: "T2", start_date: "2026-09-20" });
    const { res } = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [
        { creative_id: a.id, investment_cents: 500, sales: 1, revenue_cents: 1000, clicks_meta: 10, clicks_shopee: 10 },
        { creative_id: b.id, investment_cents: -5, sales: 0, clicks_meta: 0, clicks_shopee: 0 },
      ],
    });
    expect(res.status).toBe(400);
    const day = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/entries?date=2026-09-20`)
    ).json()) as { data: any[] };
    expect(day.data.every((r) => r.entry == null)).toBe(true);
  });

  test("só três validações: vendas/cliques inteiros; sem aviso de vendas > cliques", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "V1", start_date: "2026-09-20" });
    const frac = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 500, sales: 1.5, clicks_meta: 10, clicks_shopee: 5 }],
    });
    expect(frac.res.status).toBe(400);

    const cookie = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 1000, sales: 12, revenue_cents: 5000, clicks_meta: 2, clicks_shopee: 10 }],
    });
    expect(cookie.res.status).toBe(200);
    expect((cookie.json.warnings ?? []).join(" ").toLowerCase()).not.toMatch(/clique/);
  });

  test("encerrado não recebe lançamento; pausado recebe (cookie)", async () => {
    const server = await boot();
    const enc = await criar(server.port, { name: "Enc 01", start_date: "2026-09-20", status: "encerrado" });
    const pau = await criar(server.port, { name: "Pau 01", start_date: "2026-09-20", status: "pausado" });
    const rEnc = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: enc.id, investment_cents: 100, sales: 0, clicks_meta: 0, clicks_shopee: 0 }],
    });
    expect(rEnc.res.status).toBe(400);
    const rPau = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: pau.id, investment_cents: 0, sales: 1, revenue_cents: 900, clicks_meta: 0, clicks_shopee: 0 }],
    });
    expect(rPau.res.status).toBe(200);
  });

  test("centavos com fração arredondam (não é 4ª validação)", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "Frac 01", start_date: "2026-09-20" });
    const r = await bulkEntries(server.port, {
      date: "2026-09-20",
      entries: [{ creative_id: a.id, investment_cents: 418.7, sales: 1, revenue_cents: 1000.4, clicks_meta: 10, clicks_shopee: 19 }],
    });
    expect(r.res.status).toBe(200);
    expect(r.json.data?.[0].investment_cents).toBe(419);
  });

  test("PUT /api/creatives/:id/entries/:date faz upsert de um dia", async () => {
    const server = await boot();
    const a = await criar(server.port, { name: "U1", start_date: "2026-09-20" });
    const res = await fetch(`http://127.0.0.1:${server.port}/api/creatives/${a.id}/entries/2026-09-20`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ investment_cents: 418, sales: 1, revenue_cents: 1000, clicks_meta: 10, clicks_shopee: 19 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.investment_cents).toBe(418);
  });
});
