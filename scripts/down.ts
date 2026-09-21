// scripts/down.ts — derruba o servidor subido com `bun run up`.
// Uso: bun run down
// Lê o lockfile (pid + porta) que o boot escreve e encerra aquele processo.
import { readFile, rm } from "node:fs/promises";
import { probeHealth } from "../src/server/app.ts";
import { lockPathFor, resolveDataDir } from "../src/server/paths.ts";

// Mesma faixa do boot (ver src/server/index.ts).
const FIRST_PORT = 4173;
const MAX_PORT_TRIES = 10;

const dataDir = resolveDataDir();
const lockPath = lockPathFor(dataDir);

let lock: { pid?: unknown; port?: unknown } | null = null;
try {
  lock = JSON.parse(await readFile(lockPath, "utf-8"));
} catch {
  lock = null;
}

if (lock && typeof lock.pid === "number" && typeof lock.port === "number") {
  const { pid, port } = lock;
  if (await probeHealth(port)) {
    try {
      process.kill(pid);
    } catch {
      // Processo já morreu.
    }
    for (let i = 0; i < 50; i += 1) {
      if (!(await probeHealth(port))) break;
      await Bun.sleep(100);
    }
    await rm(lockPath, { force: true });
    console.log(`[down] servidor da porta ${port} derrubado.`);
  } else {
    await rm(lockPath, { force: true });
    console.log("[down] lock obsoleto removido; nenhum servidor estava respondendo.");
  }
  process.exit(0);
}

for (let p = FIRST_PORT; p < FIRST_PORT + MAX_PORT_TRIES; p += 1) {
  if (await probeHealth(p)) {
    console.log(
      `[down] há servidor em http://127.0.0.1:${p} mas sem lock (provável \`bun run dev\` em outra janela) — pare com Ctrl+C naquela janela.`,
    );
    process.exit(0);
  }
}
console.log("[down] nenhum servidor rodando.");
