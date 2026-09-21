import type { Database } from "bun:sqlite";
import { ensureDataDir, openDatabase } from "./db.ts";
import { INDEX_HTML, APP_VERSION } from "./assets.ts";

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

  const server = Bun.serve({
    hostname: host,
    port: opts.port ?? 4173,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health" && req.method === "GET") {
        return Response.json({ status: "ok", version: APP_VERSION });
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
