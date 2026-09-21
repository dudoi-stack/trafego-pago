import { Database } from "bun:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import initSql from "./migrations/001_init.sql" with { type: "text" };
import { dbPathFor } from "./paths.ts";

export const CURRENT_SCHEMA_VERSION = 1;

/** Abre (criando) o SQLite fora do binário e aplica migrações.
 * Requer que o chamador tenha criado o diretório (ver `ensureDataDir`,
 * chamada pelo `startServer` antes daqui). */
export function openDatabase(dataDir: string): Database {
  const dbPath = dbPathFor(dataDir);
  const db = new Database(dbPath, { create: true });
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec("PRAGMA foreign_keys = ON;");
  applyMigrations(db);
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

function applyMigrations(db: Database): void {
  const applied = appliedVersions(db);
  if (!applied.has(1)) {
    db.exec(initSql);
    db.query("INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (1, datetime('now','localtime'));").run();
  }
}
