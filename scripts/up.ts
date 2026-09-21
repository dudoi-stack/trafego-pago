// scripts/up.ts — sobe o app em segundo plano para ver o sistema.
// Uso: bun run up   (para derrubar: bun run down)
// Reaproveita o boot de src/server/index.ts (sonda, lockfile, abre o navegador).
import { fileURLToPath } from "node:url";
import { probeHealth } from "../src/server/app.ts";

// Mesma faixa do boot (ver src/server/index.ts — não importar de lá:
// aquele módulo sobe o servidor ao ser importado).
const FIRST_PORT = 4173;
const MAX_PORT_TRIES = 10;

const ROOT = fileURLToPath(new URL("..", import.meta.url));

async function findAlive(): Promise<number | null> {
  for (let p = FIRST_PORT; p < FIRST_PORT + MAX_PORT_TRIES; p += 1) {
    if (await probeHealth(p)) return p;
  }
  return null;
}

const already = await findAlive();
if (already != null) {
  console.log(`[up] já rodando em http://127.0.0.1:${already} — abra esse endereço no navegador.`);
  process.exit(0);
}

// Garante a página mais recente embutida (barato; evita ver tela velha).
const embed = Bun.spawn(["bun", "run", "embed"], {
  cwd: ROOT,
  stdio: ["ignore", "inherit", "inherit"],
});
if ((await embed.exited) !== 0) {
  console.warn("[up] aviso: `bun run embed` falhou — subindo mesmo assim (tela pode estar desatualizada).");
}

const child = Bun.spawn(["bun", "src/server/index.ts"], {
  cwd: ROOT,
  detached: true,
  stdio: ["ignore", "ignore", "ignore"],
  env: { ...process.env },
});
// Solta o filho: o `up` termina e o servidor continua rodando.
(child as unknown as { unref?: () => void }).unref?.();

for (let i = 0; i < 150; i += 1) {
  const port = await findAlive();
  if (port != null) {
    console.log(`[up] rodando em http://127.0.0.1:${port}`);
    console.log(`[up] para derrubar: bun run down`);
    process.exit(0);
  }
  if ((await Promise.race([child.exited, Bun.sleep(100).then(() => null)])) != null) break;
  await Bun.sleep(100);
}

console.error("[up] o servidor não respondeu. Rode `bun run dev` em primeiro plano para ver o erro.");
try {
  child.kill();
} catch {
  // ignore
}
process.exit(1);
