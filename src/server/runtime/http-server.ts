// Seam HTTP (T1 — porte Node 18).
//
// O roteamento vive num handler `fetch`-padrão (Web `Request`/`Response`,
// sem Bun) criado em `app.ts`. Servir esse handler é o único ponto que toca
// o runtime: hoje `Bun.serve`, na variante Node (T3) um `node:http` com o
// mesmo handler. A interface devolvida (`hostname`, `port` real, `stop`)
// é idêntica nos dois adapters.
import { hasBunServe } from "./env.ts";

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

/** Adapter Node (T3 — variante legacy, `node:http`, sem framework externo).
 *
 * Serve o MESMO handler `fetch`-padrão do adapter Bun: rotas, métodos,
 * códigos de estado e envelopes preservados — só o transporte troca.
 * Liga somente onde o chamador mandar (`app.ts` só manda `127.0.0.1`).
 * Porta 0 = efêmera (o `port` real volta em `ServedHttp.port`).
 * `EADDRINUSE` rejeita para o boot tentar a próxima porta livre. */
export function serveNodeHttp(hostname: string, port: number, fetchHandler: FetchHandler): Promise<ServedHttp> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const onError = (err: unknown) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    };
    import("node:http").then(
      ({ createServer }) => {
        const sockets = new Set<{ destroy(): void }>();
        const server = createServer((nodeReq, nodeRes) => {
          void (async () => {
            try {
              const webReq = await nodeRequestToRequest(nodeReq, hostname);
              const webRes = await fetchHandler(webReq);
              await respondWithWebResponse(nodeRes, webRes);
            } catch {
              try {
                nodeRes.writeHead(500, { "content-type": "application/json" });
                nodeRes.end(JSON.stringify({ error: "erro_interno", warnings: [] }));
              } catch {
                // socket já foi embora
              }
            }
          })();
        });
        server.on("connection", (socket) => {
          sockets.add(socket);
          socket.on("close", () => sockets.delete(socket));
        });
        server.on("error", onError);
        server.listen(port, hostname, () => {
          settled = true;
          const addr = server.address();
          const realPort = typeof addr === "object" && addr != null ? addr.port : port;
          resolve({
            hostname,
            port: realPort,
            stop() {
              try {
                for (const s of sockets) s.destroy();
              } catch {
                // ignore
              }
              server.close();
            },
          });
        });
      },
      (err) => onError(err),
    );
  });
}

interface NodeIncoming {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", cb: (chunk: Uint8Array) => void): void;
  on(event: "end", cb: () => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
}

async function nodeRequestToRequest(nodeReq: NodeIncoming, hostname: string): Promise<Request> {
  const host = firstHeader(nodeReq.headers["host"]) ?? hostname;
  const url = new URL(nodeReq.url ?? "/", `http://${host}`).toString();
  const headers = new Headers();
  for (const [key, value] of Object.entries(nodeReq.headers)) {
    if (value == null) continue;
    // Cabeçalhos de transporte/framing pertencem à conexão original, não ao
    // Request sintético (o corpo é remontado; `host` já virou a URL).
    if (SKIP_REQUEST_HEADERS.has(key.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }
  const method = (nodeReq.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { method, headers });
  }
  const chunks: Uint8Array[] = [];
  await new Promise<void>((resolve, reject) => {
    nodeReq.on("data", (chunk) => chunks.push(chunk));
    nodeReq.on("end", () => resolve());
    nodeReq.on("error", (err) => reject(err));
  });
  if (chunks.length === 0) {
    return new Request(url, { method, headers });
  }
  const body = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  // `duplex: "half"` é o exigido pelo undici (Node) quando o corpo é um
  // stream; aqui o corpo vai bufferizado (tamanho conhecido), mas a opção é
  // aceita nos dois runtimes e blinda o caminho legacy se um dia virar stream.
  return new Request(url, { method, headers, body: new Uint8Array(body), duplex: "half" } as RequestInit);
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/** Cabeçalhos da conexão original que não atravessam para o Request sintético. */
const SKIP_REQUEST_HEADERS: ReadonlySet<string> = new Set([
  "host",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-length",
  "upgrade",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

interface NodeOutgoing {
  writeHead(status: number, headers: Record<string, string | string[]>): void;
  end(body: Uint8Array): void;
}

async function respondWithWebResponse(
  nodeRes: NodeOutgoing,
  webRes: Response,
): Promise<void> {
  const outHeaders: Record<string, string | string[]> = {};
  const cookies = typeof (webRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (webRes.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
    : null;
  webRes.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie" && cookies != null) return;
    outHeaders[key] = value;
  });
  if (cookies != null && cookies.length > 0) outHeaders["set-cookie"] = cookies;
  const buf = Buffer.from(await webRes.arrayBuffer());
  nodeRes.writeHead(webRes.status, outHeaders);
  nodeRes.end(buf);
}

/** Despacha para o adapter do runtime atual, mesma interface nos dois. */
export function serveHttpForRuntime(
  hostname: string,
  port: number,
  fetchHandler: FetchHandler,
): Promise<ServedHttp> {
  if (hasBunServe()) return Promise.resolve(serveHttp(hostname, port, fetchHandler));
  return serveNodeHttp(hostname, port, fetchHandler);
}
