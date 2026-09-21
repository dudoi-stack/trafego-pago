import type { Database } from "bun:sqlite";
import { ensureDataDir, openDatabase } from "./db.ts";
import { INDEX_HTML, APP_VERSION } from "./assets.ts";
import { createCreative, createCreativesBulk, getCreative, listCreatives } from "./creatives.ts";
import { getDay, saveDayBulk, saveOneEntry } from "./entries.ts";
import { isValidDate } from "../shared/calc.ts";

export interface StartServerOptions {
  host?: string;
  port?: number;
  dataDir: string;
}

export interface StartedServer {
  hostname: string;
  port: number;
  url: string;
  dataDir: string;
  db: Database;
  stop: () => void;
}

const LOOPBACK = "127.0.0.1";

/** Sobe o servidor somente em loopback. Porta 0 = efêmera (testes). */
export async function startServer(opts: StartServerOptions): Promise<StartedServer> {
  const host = opts.host ?? LOOPBACK;
  if (host !== LOOPBACK) {
    throw new Error(`[gestor] host ${host} recusado: só ${LOOPBACK} (nunca expor na rede)`);
  }
  await ensureDataDir(opts.dataDir);
  const db = openDatabase(opts.dataDir);
  // Módulo único de cálculo: fonte em src/shared/calc.ts, transpilado na hora
  // para o navegador (ao-vivo). Cacheado no boot; em `bun build --compile`
  // o `scripts/embed-assets.ts` gera `src/web/shared/calc.js` antes de embutir.
  let calcJs: string | null = null;
  async function getCalcJs(): Promise<string> {
    if (calcJs != null) return calcJs;
    const src = await Bun.file(new URL("../shared/calc.ts", import.meta.url)).text();
    calcJs = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
    return calcJs;
  }
  try {
    await getCalcJs();
  } catch {
    // Em exe sem arquivo-fonte ao lado, o fallback é o asset embutido (T6 cobre).
    calcJs = null;
  }

  const server = Bun.serve({
    hostname: host,
    port: opts.port ?? 4173,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health" && req.method === "GET") {
        return Response.json({ status: "ok", version: APP_VERSION });
      }
      // Módulo único de cálculo servido ao navegador para o ao-vivo.
      if (url.pathname === "/shared/calc.js" && req.method === "GET") {
        try {
          const js = await getCalcJs();
          return new Response(js, {
            headers: { "content-type": "text/javascript; charset=utf-8" },
          });
        } catch {
          return Response.json({ error: "calc_indisponivel" }, { status: 500 });
        }
      }
      if (url.pathname === "/api/creatives" && req.method === "GET") {
        const data = listCreatives(db, {
          q: url.searchParams.get("q") ?? "",
          status: url.searchParams.get("status") ?? "all",
          product: url.searchParams.get("product") ?? "",
        });
        return Response.json({ data, warnings: [] });
      }
      if (url.pathname === "/api/creatives/bulk" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = createCreativesBulk(db, (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (url.pathname === "/api/creatives" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = createCreative(db, (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      const detail = url.pathname.match(/^\/api\/creatives\/(\d+)$/);
      if (detail && req.method === "GET") {
        const item = getCreative(db, Number(detail[1]));
        if (!item) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({ data: item, warnings: [] });
      }
      const entryUpsert = url.pathname.match(/^\/api\/creatives\/(\d+)\/entries\/(\d{4}-\d{2}-\d{2})$/);
      if (entryUpsert && req.method === "PUT") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = saveOneEntry(db, Number(entryUpsert[1]), entryUpsert[2], (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (url.pathname === "/api/entries" && req.method === "GET") {
        const date = url.searchParams.get("date") ?? "";
        if (!isValidDate(date)) {
          return Response.json({ error: "data_invalida", warnings: [] }, { status: 400 });
        }
        const data = getDay(db, date);
        return Response.json({ date, data, warnings: [] });
      }
      if (url.pathname === "/api/entries/bulk" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const rec = (body ?? {}) as Record<string, unknown>;
        const result = saveDayBulk(db, typeof rec.date === "string" ? rec.date : "", rec.entries);
        return Response.json(result.body, { status: result.statusCode });
      }
      if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
        return new Response(INDEX_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });

  return {
    hostname: server.hostname ?? host,
    port: server.port ?? (opts.port ?? 4173),
    url: `http://${server.hostname ?? host}:${server.port ?? opts.port ?? 4173}`,
    dataDir: opts.dataDir,
    db,
    stop() {
      server.stop(true);
      db.close();
    },
  };
}

/** Sonda se já existe instância saudável na porta. */
export async function probeHealth(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`http://${LOOPBACK}:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}
