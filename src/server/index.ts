import { rm } from "node:fs/promises";
import { openBrowser } from "./browser.ts";
import { probeHealth, startServer } from "./app.ts";
import { findRunningInstance, isPidAlive, readLock, startOnFirstFreePort, writeLock, type LockInfo } from "./boot.ts";
import { lockPathFor, resolveDataDir } from "./paths.ts";

export const DEFAULT_PORT = 4173;
export const MAX_PORT_TRIES = 10;

async function handleExistingInstance(port: number): Promise<never> {
  const url = `http://127.0.0.1:${port}`;
  console.log(`[gestor] já rodando em ${url} — abrindo o navegador.`);
  await openBrowser(url);
  process.exit(0);
}

async function boot(): Promise<void> {
  const dataDir = resolveDataDir();
  const lockPath = lockPathFor(dataDir);

  // 1+2) Trava + sonda: segunda abertura só abre o navegador.
  const running = await findRunningInstance({
    lock: await readLock(lockPath),
    isAlive: isPidAlive,
    probe: (port) => probeHealth(port),
    firstPort: DEFAULT_PORT,
    maxTries: MAX_PORT_TRIES,
  });
  if (running != null) await handleExistingInstance(running);

  // 3) Porta ocupada → próxima livre.
  try {
    const started = await startOnFirstFreePort({
      firstPort: DEFAULT_PORT,
      maxTries: MAX_PORT_TRIES,
      start: (port) => startServer({ host: "127.0.0.1", port, dataDir }),
    });
    const info: LockInfo = { pid: process.pid, port: started.port, startedAt: new Date().toISOString() };
    await writeLock(lockPath, info);
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
    // startOnFirstFreePort só joga para cá porta ocupada em toda a faixa
    // ou erro real (ex.: banco corrompido) — nunca esconder a causa raiz.
    console.error(`[gestor] falha ao subir: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`[gestor] nenhuma porta livre entre ${DEFAULT_PORT} e ${DEFAULT_PORT + MAX_PORT_TRIES - 1}.`);
    process.exit(1);
  }
}

await boot();
