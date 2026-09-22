import { afterEach, describe, expect, test } from "./support/parity.ts";
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
  const dataDir = await mkdtemp(join(tmpdir(), "gestor-test-"));
  dirs.push(dataDir);
  const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
  servers.push(server);
  return server;
}

describe("GET /api/health (contrato Fase 0)", () => {
  test("responde 200 com status ok em JSON", async () => {
    const server = await boot();
    const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as { status?: string };
    expect(body.status).toBe("ok");
  });

  test("só atende em loopback (servidor preso a 127.0.0.1)", async () => {
    const server = await boot();
    expect(server.hostname).toBe("127.0.0.1");
  });
});

describe("POST /api/creatives + GET /api/creatives (T2 — cadastro único + biblioteca mínima)", () => {
  async function criar(serverPort: number, body: Record<string, unknown>) {
    const res = await fetch(`http://127.0.0.1:${serverPort}/api/creatives`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { data?: any; warnings?: string[]; error?: string };
    return { res, json };
  }

  test("cadastra um Criativo com todos os campos e vê na biblioteca com totais zerados", async () => {
    const server = await boot();
    const { res, json } = await criar(server.port, {
      name: "Depoimento cozinha 03",
      product: "Mini processador",
      format: "video",
      start_date: "2026-09-20",
      status: "ativo",
      url: "https://exemplo.test/v",
      notes: "gancho preço",
    });
    expect(res.status).toBe(201);
    expect(json.data.name).toBe("Depoimento cozinha 03");
    expect(json.warnings).toEqual([]);

    const list = await (await fetch(`http://127.0.0.1:${server.port}/api/creatives`)).json() as {
      data: any[];
    };
    expect(list.data).toHaveLength(1);
    const item = list.data[0];
    expect(item.name).toBe("Depoimento cozinha 03");
    expect(item.totals.investment_cents).toBe(0);
    expect(item.totals.profit_cents).toBeNull();
    expect(item.health.ruler).toBe("cinza");
    expect(item.health.dia1).toBeNull();
  });

  test("pré-cadastro futuro não conta Dia 1 nem dispara Sinal", async () => {
    const server = await boot();
    await criar(server.port, { name: "Futuro 01", start_date: "2099-01-10", status: "ativo" });
    const list = await (await fetch(`http://127.0.0.1:${server.port}/api/creatives`)).json() as {
      data: any[];
    };
    expect(list.data[0].health.saude).toBeNull();
    expect(list.data[0].health.dia1).toBeNull();
    expect(list.data[0].health.ruler).toBe("cinza");
  });

  test("nome único case-insensitive entre não-Encerrados (duplicado recusado com warnings[])", async () => {
    const server = await boot();
    await criar(server.port, { name: "Depoimento 01", start_date: "2026-09-20" });
    const dup = await criar(server.port, { name: "depoimento 01", start_date: "2026-09-20" });
    expect(dup.res.status).toBe(409);
    expect(dup.json.error).toBe("nome_duplicado");
    expect(dup.json.warnings?.length).toBeGreaterThan(0);
  });

  test("Encerrado libera o nome para reuso", async () => {
    const server = await boot();
    const first = await criar(server.port, { name: "Reuso 01", start_date: "2026-09-20", status: "encerrado" });
    expect(first.res.status).toBe(201);
    const second = await criar(server.port, { name: "reuso 01", start_date: "2026-09-20", status: "ativo" });
    expect(second.res.status).toBe(201);
  });

  test("filtros q e status na biblioteca", async () => {
    const server = await boot();
    await criar(server.port, { name: "Alpha cozinha", product: "Mini processador", start_date: "2026-09-20", status: "ativo" });
    await criar(server.port, { name: "Beta gaveta", product: "Organizador", start_date: "2026-09-20", status: "pausado" });
    const q = await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?q=alpha`)).json() as { data: any[] };
    expect(q.data).toHaveLength(1);
    expect(q.data[0].name).toBe("Alpha cozinha");
    const st = await (await fetch(`http://127.0.0.1:${server.port}/api/creatives?status=pausado`)).json() as { data: any[] };
    expect(st.data).toHaveLength(1);
    expect(st.data[0].name).toBe("Beta gaveta");
  });

  test("validações: nome obrigatório, formato e data", async () => {
    const server = await boot();
    const semNome = await criar(server.port, { name: "  ", start_date: "2026-09-20" });
    expect(semNome.res.status).toBe(400);
    const formatoRuim = await criar(server.port, { name: "X1", format: "stories", start_date: "2026-09-20" });
    expect(formatoRuim.res.status).toBe(400);
    const dataRuim = await criar(server.port, { name: "X2", start_date: "20/09/2026" });
    expect(dataRuim.res.status).toBe(400);
  });

  test("GET /api/creatives/:id volta um Criativo com totais e saúde", async () => {
    const server = await boot();
    const created = await criar(server.port, { name: "Detalhe 01", start_date: "2026-09-20" });
    const id = created.json.data.id;
    const res = await fetch(`http://127.0.0.1:${server.port}/api/creatives/${id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: any };
    expect(body.data.name).toBe("Detalhe 01");
    expect(body.data.totals).toBeDefined();
    expect(body.data.health).toBeDefined();
  });

  test("módulo único de cálculo servido ao navegador (ao-vivo)", async () => {
    const server = await boot();
    const res = await fetch(`http://127.0.0.1:${server.port}/shared/calc.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const txt = await res.text();
    expect(txt).toContain("costOf");
    expect(txt).toContain("evaluateCreative");
  });
});
