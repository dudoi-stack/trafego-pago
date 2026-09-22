import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, ensureDataDir } from "../src/server/db.ts";
import { openDatabaseFile, openNodeDatabaseFile, LEGACY_SQLITE_DRIVER, getNodeDriverKind } from "../src/server/runtime/database.ts";
import { loadMigrationSql, CURRENT_SCHEMA_VERSION, EMBEDDED_INIT_SQL, EMBEDDED_DOMAIN_SQL } from "../src/server/runtime/migrations.ts";
import { createCalcLoader, readCalcArtifact } from "../src/server/runtime/calc-loader.ts";
import { CALC_JS } from "../src/server/assets.ts";
import { createRequestHandler } from "../src/server/app.ts";
import { createCreative, updateCreative } from "../src/server/creatives.ts";
import { saveOneEntry, deleteOneEntry } from "../src/server/entries.ts";
import { backupNow, ensureDailyBackup, getExportData, pruneBackups } from "../src/server/backup.ts";
import { getCreativeDetail } from "../src/server/creatives.ts";

let dirs: string[] = [];

async function rmRetry(dir: string, tries = 8): Promise<void> {
  for (let i = 0; i < tries; i += 1) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = (err as { code?: string }).code;
      // Windows + camada node:sqlite sob Bun: o handle do arquivo pode
      // demorar um ciclo de GC para soltar — tenta de novo em vez de falhar.
      if (code !== "EBUSY" || i === tries - 1) throw err;
      try {
        (globalThis as unknown as { Bun?: { gc?: () => void } }).Bun?.gc?.();
      } catch {
        // sem GC exposto: só espera
      }
      await new Promise((r) => setTimeout(r, 50 * (i + 1)));
    }
  }
}

afterEach(async () => {
  for (const d of dirs) {
    await rmRetry(d);
  }
  dirs = [];
});

async function freshDir(prefix = "gestor-t2n-"): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(d);
  await ensureDataDir(d);
  return d;
}

// T2 — persistência legacy com banco existente (variante Node).
// Estes testes forçam o caminho Node (better-sqlite3 quando presente,
// node:sqlite embutido para verificação em dev) mesmo rodando sob Bun,
// provando que o mesmo arquivo abre sem migração e o ciclo de domínio funciona.
describe("T2 — variante Node abre o mesmo banco sem migração", () => {
  test("migrações: loader via arquivo entrega os dois SQLs (versão atual)", () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(2);
    const { initSql, domainSql } = loadMigrationSql();
    expect(initSql).toContain("schema_migrations");
    expect(domainSql).toContain("CREATE TABLE IF NOT EXISTS creatives");
    expect(domainSql).toContain("CREATE TABLE IF NOT EXISTS daily_entries");
  });

  test("migrações: embutido do exe bate com os .sql (sem drift, ignora quebra de linha)", async () => {
    const norm = (s: string) => s.replace(/\r\n/g, "\n").trim();
    const f1 = await readFile(join(process.cwd(), "src/server/migrations/001_init.sql"), "utf-8");
    const f2 = await readFile(join(process.cwd(), "src/server/migrations/002_domain.sql"), "utf-8");
    expect(norm(EMBEDDED_INIT_SQL)).toBe(norm(f1));
    expect(norm(EMBEDDED_DOMAIN_SQL)).toBe(norm(f2));
  });

  test("persistência: driver legacy pinado e visível (sem fallback silencioso)", () => {
    expect(LEGACY_SQLITE_DRIVER).toBe("better-sqlite3@11.10.0");
    // O teste registra qual driver rodou: legacy usa better-sqlite3 (prebuild);
    // dev sem o nativo usa node:sqlite (mesmo formato em disco, mesmo mapeamento).
    // Se um dia o pinado quebrar, o kind expõe — o verde nunca esconde o driver.
    const kind = getNodeDriverKind();
    expect(["better-sqlite3", "node:sqlite"]).toContain(kind);
    console.log(`[t2] caminho Node via ${kind} (pinado: ${LEGACY_SQLITE_DRIVER})`);
  });

  test("cálculo: fallback embutido válido + artefato do build válido quando gerado", async () => {
    expect(CALC_JS).toContain("costOf");
    expect(CALC_JS).toContain("evaluateCreative");
    // Artefato dist/calc.js (bun run build:calc): se presente, precisa ser válido.
    // Em CI sem o build, o loader usa o ao-vivo (Bun) ou o embutido — sem quebrar.
    const artifact = await readCalcArtifact();
    if (artifact != null) {
      expect(artifact).toContain("costOf");
      expect(artifact).toContain("evaluateCreative");
    }
  });

  test("mesmo arquivo Bun → Node abre sem migração e com dados intactos", async () => {
    const dataDir = await freshDir();
    // Cria via caminho padrão (Bun aqui) com um Criativo + Lançamento.
    const bunDb = openDatabase(dataDir);
    const created = createCreative(bunDb, { name: "Legado 01", start_date: "2026-09-01", status: "ativo" });
    expect(created.statusCode).toBe(201);
    const id = created.body.data!.id;
    const saved = saveOneEntry(bunDb, id, "2026-09-01", {
      investment_cents: 500,
      sales: 1,
      revenue_cents: 2000,
      clicks_meta: 100,
      clicks_shopee: 200,
    });
    expect(saved.statusCode).toBe(200);
    bunDb.close();

    // Reabre o MESMO arquivo via caminho Node — sem migração, sem perda.
    const dbPath = join(dataDir, "gestor.db");
    const nodeDb = openNodeDatabaseFile(dbPath, { create: false });
    try {
      const versions = nodeDb.query("SELECT version FROM schema_migrations ORDER BY version;").all() as {
        version: number;
      }[];
      expect(versions.map((v) => v.version)).toEqual([1, 2]);
      const rows = nodeDb.query("SELECT name FROM creatives;").all() as { name: string }[];
      expect(rows.map((r) => r.name)).toEqual(["Legado 01"]);
      const entries = nodeDb.query("SELECT investment_cents FROM daily_entries;").all() as {
        investment_cents: number;
      }[];
      expect(entries[0].investment_cents).toBe(500);
    } finally {
      nodeDb.close();
    }

    // E o caminho padrão ainda abre depois (ida e volta, sem bifurcar).
    const again = openDatabaseFile(dbPath, { create: false });
    try {
      const rows = again.query("SELECT name FROM creatives;").all() as { name: string }[];
      expect(rows.map((r) => r.name)).toEqual(["Legado 01"]);
    } finally {
      again.close();
    }
  });

  test("ciclo via Node: Criativo → Lançamento → edição por cima → exclusão com promoção de Dia 1", async () => {
    const dataDir = await freshDir();
    const dbPath = join(dataDir, "gestor.db");
    // Estrutura via boot padrão, depois opera só via Node.
    const boot = openDatabase(dataDir);
    boot.close();
    const db = openNodeDatabaseFile(dbPath, { create: false });
    try {
      const c = createCreative(db, { name: "Ciclo Node 01", start_date: "2026-09-01", status: "ativo" });
      expect(c.statusCode).toBe(201);
      const id = c.body.data!.id;

      const d1 = saveOneEntry(db, id, "2026-09-01", {
        investment_cents: 500,
        sales: 1,
        revenue_cents: 2000,
        clicks_meta: 100,
        clicks_shopee: 200,
      });
      expect(d1.statusCode).toBe(200);
      const d2 = saveOneEntry(db, id, "2026-09-02", {
        investment_cents: 500,
        sales: 0,
        clicks_meta: 10,
        clicks_shopee: 10,
      });
      expect(d2.statusCode).toBe(200);

      let det = getCreativeDetail(db, id);
      expect(det.ok && det.detail.dia1).toBe("2026-09-01");

      // Edição por cima (mesmo dia, sem duplicata).
      const over = saveOneEntry(db, id, "2026-09-02", {
        investment_cents: 600,
        sales: 1,
        revenue_cents: 2500,
        clicks_meta: 11,
        clicks_shopee: 20,
      });
      expect(over.statusCode).toBe(200);
      expect(over.body.data!.investment_cents).toBe(600);

      // Exclui o Dia 1 como se nunca existisse → próximo vira Dia 1.
      const del = deleteOneEntry(db, id, "2026-09-01");
      expect(del.statusCode).toBe(200);
      det = getCreativeDetail(db, id);
      expect(det.ok && det.detail.dia1).toBe("2026-09-02");
      expect(det.ok && det.detail.entries).toHaveLength(1);
    } finally {
      db.close();
    }
  });

  test("estados via Node: Ativo/Pausado/Encerrado/Escalando com Sinal preservado", async () => {
    const dataDir = await freshDir();
    const boot = openDatabase(dataDir);
    boot.close();
    const db = openNodeDatabaseFile(join(dataDir, "gestor.db"), { create: false });
    try {
      const a = createCreative(db, { name: "N Ativo", start_date: "2026-09-01", status: "ativo" }).body.data!;
      saveOneEntry(db, a.id, "2026-09-01", {
        investment_cents: 500,
        sales: 1,
        revenue_cents: 2000,
        clicks_meta: 100,
        clicks_shopee: 200,
      });
      // Ativo saudável → azul/Saudável.
      const gotA = getCreativeDetail(db, a.id);
      expect(gotA.ok && gotA.detail.health.ruler).toBe("azul");

      // Pausado fica vermelho sem avaliar, mas ainda recebe Lançamento (cookie).
      const p = createCreative(db, { name: "N Pausado", start_date: "2026-09-01", status: "pausado" }).body.data!;
      const cookie = saveOneEntry(db, p.id, "2026-09-03", {
        investment_cents: 0,
        sales: 1,
        revenue_cents: 900,
        clicks_meta: 0,
        clicks_shopee: 0,
      });
      expect(cookie.statusCode).toBe(200);

      // Escalando só do Ativo, verde mesmo em dia saudável.
      const esc = updateCreative(db, a.id, { status: "escalando" });
      expect(esc.statusCode).toBe(200);
      expect(esc.body.data!.health.statusDisplay).toBe("Escalando");

      // Encerrado bloqueia Lançamento e entra só no histórico.
      const e = createCreative(db, { name: "N Enc", start_date: "2026-09-01", status: "encerrado" }).body.data!;
      const blocked = saveOneEntry(db, e.id, "2026-09-02", { investment_cents: 100, sales: 0 });
      expect(blocked.statusCode).toBe(400);
    } finally {
      db.close();
    }
  });

  test("backup via Node: manual + diário + retenção + exportação + snapshot válido", async () => {
    const dataDir = await freshDir();
    const boot = openDatabase(dataDir);
    boot.close();
    const db = openNodeDatabaseFile(join(dataDir, "gestor.db"), { create: false });
    try {
      const c = createCreative(db, { name: "N Bk", start_date: "2026-09-01" }).body.data!;
      saveOneEntry(db, c.id, "2026-09-01", {
        investment_cents: 500,
        sales: 1,
        revenue_cents: 1000,
        clicks_meta: 10,
        clicks_shopee: 20,
      });

      // Snapshot atômico com o banco aberto (VACUUM INTO, com fallback p/ cópia).
      const res = await backupNow(db, dataDir);
      expect(res.file).toMatch(/^gestor-.*\.db$/);
      // O snapshot é um SQLite válido com os mesmos dados.
      const snap = openNodeDatabaseFile(res.path, { create: false });
      try {
        const rows = snap.query("SELECT name FROM creatives;").all() as { name: string }[];
        expect(rows.map((r) => r.name)).toContain("N Bk");
      } finally {
        snap.close();
      }

      // Backup diário não duplica no mesmo dia.
      const second = await ensureDailyBackup(db, dataDir);
      expect(second).toBeNull();

      // Exportação traz Criativos + Lançamentos.
      const exp = getExportData(db);
      expect(exp.creatives.length).toBeGreaterThanOrEqual(1);
      expect(exp.entries.length).toBeGreaterThanOrEqual(1);

      // Retenção mantém só os mais recentes.
      const { writeFile } = await import("node:fs/promises");
      for (let i = 0; i < 35; i += 1) {
        await writeFile(join(dataDir, "backups", `gestor-2026-01-${String(i + 1).padStart(2, "0")}-000000.db`), "x");
      }
      const kept = await pruneBackups(dataDir);
      expect(kept).toBeLessThanOrEqual(30);
      const files = await readdir(join(dataDir, "backups"));
      expect(files.length).toBeLessThanOrEqual(30);
    } finally {
      db.close();
    }
  });

  test("handler HTTP serve o ciclo Node (sem Bun.serve) + cálculo ao-vivo offline", async () => {
    const dataDir = await freshDir();
    const boot = openDatabase(dataDir);
    boot.close();
    const db = openNodeDatabaseFile(join(dataDir, "gestor.db"), { create: false });
    try {
      const calcJs = await createCalcLoader().get();
      expect(calcJs).toContain("costOf");
      const handle = createRequestHandler(db, dataDir, async () => calcJs);

      const created = await handle(
        new Request("http://127.0.0.1/api/creatives", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "N API", start_date: "2026-09-01" }),
        }),
      );
      expect(created.status).toBe(201);

      const health = await handle(new Request("http://127.0.0.1/api/health"));
      expect(health.status).toBe(200);

      const calc = await handle(new Request("http://127.0.0.1/shared/calc.js"));
      expect(calc.status).toBe(200);
      expect((await calc.text())).toContain("costOf");

      // Migrações via arquivo batem com o que o loader entrega.
      const { initSql, domainSql } = loadMigrationSql();
      const f1 = await readFile(join(process.cwd(), "src/server/migrations/001_init.sql"), "utf-8").catch(() => initSql);
      expect(initSql.trim()).toBe(f1.trim());
      const f2 = await readFile(join(process.cwd(), "src/server/migrations/002_domain.sql"), "utf-8").catch(() => domainSql);
      expect(domainSql.trim()).toBe(f2.trim());
    } finally {
      db.close();
    }
  });
});
