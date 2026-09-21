import { readFile, rm, writeFile } from "node:fs/promises";
import { openBrowser } from "./browser.ts";
import { probeHealth, startServer } from "./app.ts";
import { lockPathFor, resolveDataDir } from "./paths.ts";

export const DEFAULT_PORT = 4173;
export const MAX_PORT_TRIES = 10;

interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
}

async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as LockInfo;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function handleExistingInstance(port: number): Promise<never> {
  const url = `http://127.0.0.1:${port}`;
  console.log(`[gestor] já rodando em ${url} — abrindo o navegador.`);
  await openBrowser(url);
  process.exit(0);
}

async function boot(): Promise<void> {
  const dataDir = resolveDataDir();
  const lockPath = lockPathFor(dataDir);

  // 1) Lockfile + sonda: segunda abertura só abre o navegador.
  const lock = await readLock(lockPath);
  if (lock && isPidAlive(lock.pid) && (await probeHealth(lock.port))) {
    await handleExistingInstance(lock.port);
  }

  // 2) Sonda direta nas portas (cobre lock apagado/corrrompido).
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + MAX_PORT_TRIES; port += 1) {
    if (await probeHealth(port)) await handleExistingInstance(port);
  }

  // 3) Porta ocupada → próxima livre.
  for (let port = DEFAULT_PORT; port < DEFAULT_PORT + MAX_PORT_TRIES; port += 1) {
    try {
      const started = await startServer({ host: "127.0.0.1", port, dataDir });
      const info: LockInfo = { pid: process.pid, port: started.port, startedAt: new Date().toISOString() };
      await writeFile(lockPath, JSON.stringify(info, null, 2));
      console.log(`[gestor] rodando em ${started.url}`);
      console.log(`[gestor] dados em ${dataDir}`);
      await openBrowser(started.url);

      const shutdown = async () => {
        try {
          await rm(lockPath, { force: true });
        } catch {
          // ignore
        }
        started.stop();
        process.exit(0);
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/EADDRINUSE|address already in use|port.*use/i.test(msg)) continue;
      throw err;
    }
  }
  console.error(`[gestor] nenhuma porta livre entre ${DEFAULT_PORT} e ${DEFAULT_PORT + MAX_PORT_TRIES - 1}.`);
  process.exit(1);
}

await boot();
