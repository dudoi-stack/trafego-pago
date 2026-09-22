// Seam HTTP (T1 — porte Node 18).
//
// O roteamento vive num handler `fetch`-padrão (Web `Request`/`Response`,
// sem Bun) criado em `app.ts`. Servir esse handler é o único ponto que toca
// o runtime: hoje `Bun.serve`, na variante Node (T3) um `node:http` com o
// mesmo handler. A interface devolvida (`hostname`, `port` real, `stop`)
// é idêntica nos dois adapters.
export type FetchHandler = (req: Request) => Promise<Response>;

export interface ServedHttp {
  hostname: string;
  port: number;
  stop: () => void;
}

/** Adapter Bun: serve o handler em loopback. Troca só aqui na variante Node. */
export function serveHttp(hostname: string, port: number, fetchHandler: FetchHandler): ServedHttp {
  const server = Bun.serve({ hostname, port, fetch: fetchHandler });
  return {
    hostname: server.hostname ?? hostname,
    port: server.port ?? port,
    stop() {
      server.stop(true);
    },
  };
}
