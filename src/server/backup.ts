import type { Database } from "bun:sqlite";
import { mkdir, readdir, rm, copyFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { dbPathFor } from "./paths.ts";

export const MAX_BACKUPS = 30;
export const BACKUP_DIR_NAME = "backups";

export function backupDirFor(dataDir: string): string {
  return join(dataDir, BACKUP_DIR_NAME);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Nome com timestamp local: gestor-AAAA-MM-DD-HHmmss.db (ordenável). */
export function backupFileName(now = new Date()): string {
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const h = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const s = pad(now.getSeconds());
  return `gestor-${y}-${m}-${d}-${h}${mi}${s}.db`;
}

export async function listBackupFiles(dataDir: string): Promise<string[]> {
  const dir = backupDirFor(dataDir);
  try {
    const files = await readdir(dir);
    return files
      .filter((f) => f.startsWith("gestor-") && f.endsWith(".db"))
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

/** Mantém os 30 mais recentes (por nome). Retorna quantos ficaram. */
export async function pruneBackups(dataDir: string): Promise<number> {
  const dir = backupDirFor(dataDir);
  const files = await listBackupFiles(dataDir);
  if (files.length <= MAX_BACKUPS) return files.length;
  const extra = files.slice(MAX_BACKUPS);
  for (const f of extra) {
    try {
      await rm(join(dir, f), { force: true });
    } catch {
      // ignore
    }
  }
  return MAX_BACKUPS;
}

function escapeSqlString(s: string): string {
  return s.replace(/'/g, "''");
}

async function vacuumInto(db: Database, destPath: string): Promise<void> {
  // VACUUM INTO é atômico e seguro com o banco aberto (melhor que copiar o arquivo).
  db.query(`VACUUM INTO '${escapeSqlString(destPath)}';`).run();
}

export async function backupNow(db: Database, dataDir: string, now = new Date()): Promise<{ file: string; path: string; kept: number }> {
  await mkdir(backupDirFor(dataDir), { recursive: true });
  const file = backupFileName(now);
  const dest = join(backupDirFor(dataDir), file);
  try {
    await vacuumInto(db, dest);
  } catch {
    // Fallback: cópia física do arquivo (banco pequeno, journal DELETE).
    await copyFile(dbPathFor(dataDir), dest);
  }
  const kept = await pruneBackups(dataDir);
  return { file, path: dest, kept };
}

/** Backup diário: se ainda não há backup de hoje (prefixo da data), cria um. */
export async function ensureDailyBackup(db: Database, dataDir: string, now = new Date()): Promise<{ file: string; path: string } | null> {
  await mkdir(backupDirFor(dataDir), { recursive: true });
  const y = now.getFullYear();
  const m = pad(now.getMonth() + 1);
  const d = pad(now.getDate());
  const prefix = `gestor-${y}-${m}-${d}-`;
  const files = await listBackupFiles(dataDir);
  if (files.some((f) => f.startsWith(prefix))) return null;
  const res = await backupNow(db, dataDir, now);
  return { file: res.file, path: res.path };
}

export async function backupFileSize(dataDir: string, file: string): Promise<number | null> {
  try {
    const st = await stat(join(backupDirFor(dataDir), file));
    return st.size;
  } catch {
    return null;
  }
}

export function getExportData(db: Database): { creatives: unknown[]; entries: unknown[]; settings: unknown[]; exported_at: string } {
  const creatives = db.query("SELECT id, name, product, format, status, start_date, url, notes, created_at FROM creatives ORDER BY id ASC;").all() as unknown[];
  const entries = db
    .query("SELECT creative_id, date, investment_cents, sales, revenue_cents, clicks_meta, clicks_shopee, tax_rate, created_at, updated_at FROM daily_entries ORDER BY creative_id ASC, date ASC;")
    .all() as unknown[];
  const settings = db.query("SELECT key, value FROM settings ORDER BY key ASC;").all() as unknown[];
  return { creatives, entries, settings, exported_at: new Date().toISOString() };
}
