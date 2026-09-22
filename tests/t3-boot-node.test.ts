import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveNodeHttp } from "../src/server/runtime/http-server.ts";
import { findRunningInstance, isPidAlive, readLock, startOnFirstFreePort } from "../src/server/boot.ts";
import { openDatabase } from "../src/server/db.ts";
import { createRequestHandler } from "../src/server/app.ts";
import { createCalcLoader } from "../src/server/runtime/calc-loader.ts";

// T3 (porte Node) — servidor local atrás da mesma seam HTTP da T1.
// Comportamento observado via HTTP real em 127.0.0.1, nunca via internos:
// o adapter Node serve o mesmo handler `fetch`-padrão com o mesmo contrato
// (rotas, métodos, códigos, envelopes) do adapter Bun.
describe("T3 — adapter Node serve o handler fetch-padrão em loopback", () => {
  test("saúde responde 200 com status ok via HTTP real (porta efêmera)", async () => {
    const served = await serveNodeHttp("127.0.0.1", 0, async () => Response.json({ status: "ok" }));
    try {
      expect(served.hostname).toBe("127.0.0.1");
      expect(served.port).toBeGreaterThan(0);
      const res = await fetch(`http://127.0.0.1:${served.port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status?: string };
      expect(body.status).toBe("ok");
    } finally {
      served.stop();
    }
  });

  test("POST com JSON preserva corpo, método, código e envelope", async () => {
    const served = await serveNodeHttp("127.0.0.1", 0, async (req) => {
      if (req.method === "POST" && new URL(req.url).pathname === "/api/creatives") {
        const body = (await req.json()) as { name?: string };
        return Response.json({ data: { name: body.name }, warnings: [] }, { status: 201 });
      }
      return Response.json({ error: "not_found", warnings: [] }, { status: 404 });
    });
    try {
      const created = await fetch(`http://127.0.0.1:${served.port}/api/creatives`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Via Node 01" }),
      });
      expect(created.status).toBe(201);
      const json = (await created.json()) as { data: { name: string }; warnings: string[] };
      expect(json.data.name).toBe("Via Node 01");
      expect(json.warnings).toEqual([]);

      const missing = await fetch(`http://127.0.0.1:${served.port}/api/nao-existe`);
      expect(missing.status).toBe(404);
    } finally {
      served.stop();
    }
  });

  test("arquivo binário atravessa intacto com o content-type original", async () => {
    const bytes = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0x00, 0xff]);
    const served = await serveNodeHttp("127.0.0.1", 0, async () => {
      // Response com Uint8Array: caminho dos .woff2 locais (offline).
      return new Response(bytes, { headers: { "content-type": "font/woff2" } });
    });
    try {
      const res = await fetch(`http://127.0.0.1:${served.port}/fonte.woff2`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("font/woff2");
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    } finally {
      served.stop();
    }
  });

  test("porta ocupada rejeita com EADDRINUSE (boot tenta a próxima livre)", async () => {
    const occupier = await serveNodeHttp("127.0.0.1", 0, async () => new Response("ocupada"));
    try {
      const busyPort = occupier.port;
      const probe = await fetch(`http://127.0.0.1:${busyPort}/`);
      expect(probe.status).toBe(200);
      let err: unknown = null;
      try {
        await serveNodeHttp("127.0.0.1", busyPort, async () => new Response("nunca"));
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
      const code = (err as { code?: unknown })?.code;
      const msg = String((err as Error)?.message ?? err);
      expect(code === "EADDRINUSE" || /EADDRINUSE|address already in use|port.*in use/i.test(msg)).toBe(true);
    } finally {
      occupier.stop();
    }
  });
});

// T3 — trava e faixa de portas do boot (segunda abertura nunca duplica).
// Observado via o módulo `boot.ts` (puro, sem process.exit): o `index.ts`
// só liga essas funções aos efeitos (navegador, saída do processo).
describe("T3 — trava impede segunda instância e porta ocupada leva à próxima livre", () => {
  test("readLock: sem arquivo, corrompido ou sem pid/porta → null", async () => {
    const dir = await mkdtemp(join(tmpdir(), "gestor-t3-lock-"));
    try {
      expect(await readLock(join(dir, "gestor.lock"))).toBeNull();
      await writeFile(join(dir, "gestor.lock"), "não é json {");
      expect(await readLock(join(dir, "gestor.lock"))).toBeNull();
      await writeFile(join(dir, "gestor.lock"), JSON.stringify({ pid: "x" }));
      expect(await readLock(join(dir, "gestor.lock"))).toBeNull();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("isPidAlive: este processo vivo, pid absurdo morto", async () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(2 ** 30)).toBe(false);
  });

  test("findRunningInstance: trava viva+saudável vence; trava obsoleta cai na sonda", async () => {
    const lock = { pid: 111, port: 4173, startedAt: "2026-09-22T00:00:00.000Z" };
    // Trava viva e saudável → porta da trava.
    expect(
      await findRunningInstance({
        lock,
        isAlive: () => true,
        probe: async (port) => port === 4173,
        firstPort: 4173,
        maxTries: 10,
      }),
    ).toBe(4173);
    // Trava morta + sonda acha 4175 → 4175 (cobre trava apagada/corrompida).
    expect(
      await findRunningInstance({
        lock: null,
        isAlive: () => false,
        probe: async (port) => port === 4175,
        firstPort: 4173,
        maxTries: 10,
      }),
    ).toBe(4175);
    // Nada rodando → null (boot segue para subir o servidor).
    expect(
      await findRunningInstance({
        lock: null,
        isAlive: () => false,
        probe: async () => false,
        firstPort: 4173,
        maxTries: 10,
      }),
    ).toBeNull();
  });

  test("startOnFirstFreePort: EADDRINUSE pula, outro erro propaga", async () => {
    const tried: number[] = [];
    const started = await startOnFirstFreePort({
      firstPort: 4173,
      maxTries: 3,
      start: async (port) => {
        tried.push(port);
        if (port === 4173) throw new Error("listen EADDRINUSE: address already in use");
        return { port } as { port: number };
      },
    });
    expect(started.port).toBe(4174);
    expect(tried).toEqual([4173, 4174]);

    let err: unknown = null;
    try {
      await startOnFirstFreePort({
        firstPort: 4173,
        maxTries: 3,
        start: async () => {
          throw new Error("banco corrompido");
        },
      });
    } catch (e) {
      err = e;
    }
    expect(String((err as Error)?.message ?? err)).toMatch(/banco corrompido/);
  });
});

// T3 — ponta a ponta via HTTP real no adapter Node: página, ativos e cálculo
// servidos offline (sem CDN) + domínio navegável como no padrão (Criativos,
// Lançamentos, Sinal, Escalando, ROAS, Imposto).
describe("T3 — app inteiro servido pelo adapter Node, offline e como no padrão", () => {
  async function bootNodeApp() {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-t3-app-"));
    const db = openDatabase(dataDir);
    const calcJs = await createCalcLoader().get();
    const served = await serveNodeHttp("127.0.0.1", 0, createRequestHandler(db, dataDir, async () => calcJs));
    return {
      base: `http://127.0.0.1:${served.port}`,
      async stop() {
        served.stop();
        db.close();
        await rm(dataDir, { recursive: true, force: true });
      },
    };
  }

  test("página, cálculo ao-vivo e sonda offline, sem nada externo", async () => {
    const app = await bootNodeApp();
    try {
      const health = await fetch(`${app.base}/api/health`);
      expect(health.status).toBe(200);

      const page = await fetch(`${app.base}/`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("Gestor");
      expect(html).not.toMatch(/fonts\.googleapis\.com/);
      expect(html).not.toMatch(/<script[^>]+src="https?:\/\//);

      const calc = await fetch(`${app.base}/shared/calc.js`);
      expect(calc.status).toBe(200);
      expect(calc.headers.get("content-type")).toContain("javascript");
      const js = await calc.text();
      expect(js).toContain("costOf");
      expect(js).toContain("evaluateCreative");
    } finally {
      await app.stop();
    }
  });

  test("Criativos, Lançamentos, Sinal, Escalando, ROAS e Imposto como no padrão", async () => {
    const app = await bootNodeApp();
    try {
      const post = (path: string, body: unknown) =>
        fetch(`${app.base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      // Criativo com totais zerados ao cadastrar.
      const created = await post("/api/creatives", { name: "Node E2E 01", start_date: "2026-09-01", status: "ativo" });
      expect(created.status).toBe(201);
      const { data } = (await created.json()) as { data: { id: number } };
      const id = data.id;

      // Lançamento do dia.
      const put = await fetch(`${app.base}/api/creatives/${id}/entries/2026-09-01`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ investment_cents: 500, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 }),
      });
      expect(put.status).toBe(200);

      // Detalhe: Dia 1 + Imposto compondo o custo do dia.
      const detail = (await (await fetch(`${app.base}/api/creatives/${id}/entries`)).json()) as {
        data: { entries: { tax_rate: number }[]; dia1: string };
        warnings: string[];
      };
      expect(detail.data.dia1).toBe("2026-09-01");
      expect(detail.data.entries[0].tax_rate).toBeCloseTo(0.1386, 4);
      const lib = (await (await fetch(`${app.base}/api/creatives`)).json()) as {
        data: { health: { ruler: string }; totals: { roas_equivalente: number | null } }[];
      };
      // Sinal azul saudável + ROAS comparável.
      expect(lib.data[0].health.ruler).toBe("azul");
      expect(lib.data[0].totals.roas_equivalente).not.toBeNull();

      // Escalando: verde mesmo em dia de atenção, vindo do Ativo.
      const esc = await fetch(`${app.base}/api/creatives/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "escalando" }),
      });
      expect(esc.status).toBe(200);
      const escJson = (await esc.json()) as { data: { health: { statusDisplay: string } } };
      expect(escJson.data.health.statusDisplay).toBe("Escalando");

      // Painel com ROAS e Imposto navegáveis como no padrão.
      const dash = await fetch(`${app.base}/api/dashboard?from=2026-09-01&to=2026-09-01`);
      expect(dash.status).toBe(200);
      const dashJson = (await dash.json()) as { data: { totals: { investment_cents: number } }; warnings: string[] };
      expect(dashJson.data.totals.investment_cents).toBe(500);
      expect(dashJson.warnings).toEqual([]);
    } finally {
      await app.stop();
    }
  });
});
