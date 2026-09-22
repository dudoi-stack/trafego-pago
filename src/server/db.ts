import { mkdir } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CURRENT_SCHEMA_VERSION, loadMigrationSql } from "./runtime/migrations.ts";
import { openDatabaseFile, type Database } from "./runtime/database.ts";
import { dbPathFor } from "./paths.ts";

export { CURRENT_SCHEMA_VERSION };
export type { Database };

/** Abre (criando) o SQLite fora do binário e aplica migrações.
 * Requer que o chamador tenha criado o diretório (ver `ensureDataDir`,
 * chamada pelo `startServer` antes daqui).
 * T6: se houver migração pendente num banco já existente, faz
 * backup-antes-de-migrar (VACUUM INTO atômico, antes do primeiro SQL) —
 * atualizar = trocar só o executável. Se o backup falhar, migra mesmo
 * assim (nunca trava o boot; o backup diário pós-boot ainda protege). */
export function openDatabase(dataDir: string): Database {
  const dbPath = dbPathFor(dataDir);
  const preexisted = existsSync(dbPath);
  const db = openDatabaseFile(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db, preexisted ? dataDir : null);
  return db;
}

export async function ensureDataDir(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  await mkdir(join(dataDir, "backups"), { recursive: true });
}

function appliedVersions(db: Database): Set<number> {
  db.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
  );
  const rows = db.query("SELECT version FROM schema_migrations;").all() as {
    version: number;
  }[];
  return new Set(rows.map((r) => r.version));
}

function pendingVersions(applied: Set<number>): number[] {
  const out: number[] = [];
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v += 1) {
    if (!applied.has(v)) out.push(v);
  }
  return out;
}

function preMigracaoFileName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const y = now.getFullYear();
  const m = p(now.getMonth() + 1);
  const d = p(now.getDate());
  const h = p(now.getHours());
  const mi = p(now.getMinutes());
  const s = p(now.getSeconds());
  return `gestor-${y}-${m}-${d}-${h}${mi}${s}-pre-migracao.db`;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

/** Backup-antes-de-migrar: snapshot do banco exatamente como estava antes
 * do primeiro SQL de migração. Síncrono (VACUUM INTO com o banco aberto,
 * atômico). Nunca derruba o boot se falhar — o backup diário pós-boot em
 * `startServer` ainda protege. */
function backupBeforeMigrateSync(db: Database, dataDir: string): void {
  try {
    mkdirSync(join(dataDir, "backups"), { recursive: true });
    const dest = join(dataDir, "backups", preMigracaoFileName());
    db.query(`VACUUM INTO '${escapeSqlString(dest)}';`).run();
  } catch (err) {
    console.warn(`[gestor] backup-antes-de-migrar falhou: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function applyMigrations(db: Database, dataDirForPreBackup: string | null): void {
  const applied = appliedVersions(db);
  const pending = pendingVersions(applied);
  // Banco novo (criado agora): primeira abertura cria estrutura, sem backup.
  // Banco existente com migração pendente: backup-antes-de-migrar antes do SQL.
  if (dataDirForPreBackup != null && pending.length > 0) {
    backupBeforeMigrateSync(db, dataDirForPreBackup);
  }
  const { initSql, domainSql } = loadMigrationSql();
  if (!applied.has(1)) {
    db.exec(initSql);
    db.query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, datetime('now','localtime'));").run();
  }
  if (!applied.has(2)) {
    db.exec(domainSql);
    db.query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (2, datetime('now','localtime'));").run();
  }
}
