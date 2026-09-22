import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, ensureDataDir } from "../src/server/db.ts";
import { createRequestHandler } from "../src/server/app.ts";
import { loadMigrationSql, CURRENT_SCHEMA_VERSION } from "../src/server/runtime/migrations.ts";
import { openDatabaseFile } from "../src/server/runtime/database.ts";
import { createCalcLoader } from "../src/server/runtime/calc-loader.ts";
import { sleep } from "../src/server/runtime/wait.ts";
import { openBrowser } from "../src/server/browser.ts";

let dirs: string[] = [];

afterEach(async () => {
  for (const d of dirs) {
    await rm(d, { recursive: true, force: true });
  }
  dirs = [];
});

// T1 — seams finas do runtime: cada amarração do Bun vive num módulo
// trocável em src/server/runtime/, sem mudar o comportamento do produto.
describe("T1 — seams do runtime", () => {
  test("migrações: loader entrega os dois SQLs com as tabelas do domínio", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    const { initSql, domainSql } = loadMigrationSql();
    expect(initSql).toContain("schema_migrations");
    expect(domainSql).toContain("CREATE TABLE IF NOT EXISTS creatives");
    expect(domainSql).toContain("CREATE TABLE IF NOT EXISTS daily_entries");
  });

  test("persistência: adapter abre, escreve e lê sem bun:sqlite no domínio", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-t1-"));
    dirs.push(dataDir);
    await ensureDataDir(dataDir);
    const db = openDatabaseFile(join(dataDir, "seam.db"), { create: true });
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT);");
    db.query("INSERT INTO t (name) VALUES (?);").run("seam");
    const rows = db.query("SELECT name FROM t;").all() as { name: string }[];
    expect(rows.map((r) => r.name)).toEqual(["seam"]);
    db.close();
    // openDatabase (boot real) continua criando estrutura + versão atual.
    const boot = openDatabase(dataDir);
    const versions = boot.query("SELECT version FROM schema_migrations ORDER BY version;").all() as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toEqual([1, 2]);
    boot.close();
  });

  test("cálculo: loader serve o JS ao-vivo com costOf", async () => {
    const js = await createCalcLoader().get();
    expect(js).toContain("costOf");
    expect(js).toContain("evaluateCreative");
  });

  test("http: handler puro responde /api/health sem Bun.serve", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-t1-h-"));
    dirs.push(dataDir);
    await ensureDataDir(dataDir);
    const db = openDatabase(dataDir);
    try {
      const handle = createRequestHandler(db, dataDir, async () => "export const x = 1;");
      const res = await handle(new Request("http://127.0.0.1/api/health"));
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status?: string };
      expect(body.status).toBe("ok");
      const notFound = await handle(new Request("http://127.0.0.1/api/nao-existe"));
      expect(notFound.status).toBe(404);
    } finally {
      db.close();
    }
  });

  test("navegador: suprimido por env não abre nada nem quebra", async () => {
    process.env.GESTOR_NO_BROWSER = "1";
    try {
      await expect(openBrowser("http://127.0.0.1:4173")).resolves.toBeUndefined();
    } finally {
      delete process.env.GESTOR_NO_BROWSER;
    }
  });

  test("espera: sleep resolve sem Bun.sleep", async () => {
    const t0 = Date.now();
    await sleep(20);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });
});
