import { homedir } from "node:os";
import { join } from "node:path";

export const APP_DIR_NAME = "GestorTrafego";
export const DB_FILE_NAME = "gestor.db";
export const LOCK_FILE_NAME = "gestor.lock";

/** Pasta de dados fora do binário (spec #6). Permite override via env (testes/dev). */
export function resolveDataDir(): string {
  const override = process.env.GESTOR_DATA_DIR?.trim();
  if (override) return override;
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || join(homedir(), "AppData", "Roaming");
    return join(appData, APP_DIR_NAME);
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_DIR_NAME);
  }
  const xdg = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
  return join(xdg, APP_DIR_NAME);
}

export function dbPathFor(dataDir: string): string {
  return join(dataDir, DB_FILE_NAME);
}

export function lockPathFor(dataDir: string): string {
  return join(dataDir, LOCK_FILE_NAME);
}
