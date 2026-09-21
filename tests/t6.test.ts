import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { startServer } from "../src/server/app.ts";
import { formatBRL, parseInteiro, parseMoedaParaCentavos } from "../src/shared/calc.ts";

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

async function boot(dataDir?: string) {
  const dir = dataDir ?? (await mkdtemp(join(tmpdir(), "gestor-t6-")));
  if (!dataDir) dirs.push(dir);
  const server = await startServer({ host: "127.0.0.1", port: 0, dataDir: dir });
  servers.push(server);
  return { server, dataDir: dir };
}

describe("T6 — valores em R$ no formato brasileiro (aceita 4,18 e 4.18)", () => {
  test("parseMoedaParaCentavos aceita vírgula e ponto", () => {
    expect(parseMoedaParaCentavos("4,18")).toBe(418);
    expect(parseMoedaParaCentavos("4.18")).toBe(418);
    expect(parseMoedaParaCentavos("1.234,56")).toBe(123456);
    expect(parseMoedaParaCentavos("")).toBeNull();
    expect(parseMoedaParaCentavos(null)).toBeNull();
  });

  test("parseInteiro aceita vendas/cliques inteiros", () => {
    expect(parseInteiro("3")).toBe(3);
    expect(parseInteiro("")).toBeNull();
  });

  test("formatBRL exibe R$ brasileiro (vírgula decimal)", () => {
    const s = formatBRL(418);
    expect(s).toContain("R$");
    expect(s).toContain("4,18");
  });
});

describe("T6 — 100% offline (fontes locais, sem CDN)", () => {
  test("index.html não referencia nada externo (http, CDN, Google Fonts)", async () => {
    const html = await readFile(new URL("../src/web/index.html", import.meta.url), "utf-8");
    // Permite http://127.0.0.1 e https://exemplo.test (placeholder de input);
    // o que não pode é CDN/fonte remota/JS remoto.
    expect(html).not.toMatch(/fonts\.googleapis\.com/);
    expect(html).not.toMatch(/fonts\.gstatic\.com/);
    expect(html).not.toMatch(/cdn\.|unpkg\.com|jsdelivr/);
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\//);
    expect(html).not.toMatch(/<script[^>]+src="https?:\/\//);
    expect(html).not.toMatch(/@import\s+url\(/);
  });

  test("GET / serve a página sem URLs externas e /shared/calc.js é local", async () => {
    const { server } = await boot();
    const html = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
    expect(html).toContain("Gestor");
    expect(html).not.toMatch(/fonts\.googleapis\.com/);

    const calc = await fetch(`http://127.0.0.1:${server.port}/shared/calc.js`);
    expect(calc.status).toBe(200);
    expect(calc.headers.get("content-type")).toContain("javascript");
    const txt = await calc.text();
    expect(txt).toContain("costOf");
  });

  test("módulo de cálculo embutido no bundle (exe sem fonte ao lado continua servindo)", async () => {
    // O bundle embutido é gerado por `bun run embed` em src/server/assets.ts.
    const assets = await readFile(new URL("../src/server/assets.ts", import.meta.url), "utf-8");
    expect(assets).toContain("CALC_JS");
  });
});

describe("T6 — atualização sem medo (migração + backup automáticos, backup-antes-de-migrar)", () => {
  async function makeV1Db(dataDir: string): Promise<void> {
    // Simula um banco da versão anterior: só migração 1 aplicada + um dado.
    const db = new Database(join(dataDir, "gestor.db"), { create: true });
    db.exec("PRAGMA journal_mode = DELETE;");
    db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    db.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    db.exec("INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0.1386');");
    db.exec("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, datetime('now','localtime'));");
    db.close();
  }

  test("abrir com banco antigo migra sem perder nada e deixa backup-antes-de-migrar", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-t6-mig-"));
    dirs.push(dataDir);
    await makeV1Db(dataDir);

    const { server } = await boot(dataDir);
    // Migrou para a versão atual: tabela de domínio existe.
    const tables = server.db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='creatives';")
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);
    const versions = server.db.query("SELECT version FROM schema_migrations ORDER BY version;").all() as {
      version: number;
    }[];
    expect(versions.map((v) => v.version)).toContain(1);
    expect(versions.map((v) => v.version)).toContain(2);

    // Backup-antes-de-migrar existe nos backups.
    const files = await readdir(join(dataDir, "backups"));
    const pre = files.filter((f) => f.includes("pre-migracao"));
    expect(pre.length).toBeGreaterThanOrEqual(1);

    // O backup é o banco ANTES da migração (sem a tabela creatives).
    const probe = new Database(join(dataDir, "backups", pre[0]), { readonly: true });
    const oldTables = probe
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='creatives';")
      .all() as unknown[];
    probe.close();
    expect(oldTables).toHaveLength(0);
  });

  test("trocar só o executável não perde nada (dados fora do binário, reboot preserva)", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-t6-upd-"));
    dirs.push(dataDir);
    const { server } = await boot(dataDir);
    const created = (await (
      await fetch(`http://127.0.0.1:${server.port}/api/creatives`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Persiste 01", start_date: "2026-09-01" }),
      })
    ).json()) as { data: { id: number } };
    server.stop();
    servers.pop();

    // "Novo executável": segundo boot no mesmo dataDir.
    const server2 = await startServer({ host: "127.0.0.1", port: 0, dataDir });
    servers.push(server2);
    const list = (await (
      await fetch(`http://127.0.0.1:${server2.port}/api/creatives`)
    ).json()) as { data: { name: string }[] };
    expect(list.data.map((c) => c.name)).toContain("Persiste 01");
    expect(created.data.id).toBeGreaterThan(0);
  });

  test("LEIA-ME de 3 passos cobre Win+Mac, SmartScreen, Gatekeeper e atualização", async () => {
    const { buildLeiaMe } = await import("../src/server/leia-me.ts");
    const txt = buildLeiaMe("0.1.0");
    expect(txt).toMatch(/3 passos/i);
    expect(txt).toMatch(/Mais informações[\s\S]*Executar assim mesmo/);
    expect(txt).toMatch(/Gatekeeper|clique.*direito.*Abrir/i);
    expect(txt).toMatch(/troque s[oó] o executável/i);
    expect(txt).toMatch(/backup/i);
    expect(txt).toMatch(/offline/i);
  });
});
