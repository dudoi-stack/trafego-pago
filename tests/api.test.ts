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
