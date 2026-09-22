// Boot de duplo clique (T3 — servidor local).
//
// Lógica pura do boot: trava em disco + sonda de saúde + faixa de portas.
// Compartilhada pelos dois runtimes (Bun padrão, Node legacy): só usa
// `node:fs/promises` e `process.kill`, presentes nos dois.
// Sem efeitos aqui (sem navegador, sem process.exit) — o `index.ts` liga
// estas funções aos efeitos. Testes em `tests/t3-boot-node.test.ts`.
import { readFile, writeFile } from "node:fs/promises";

export interface LockInfo {
  pid: number;
  port: number;
  startedAt: string;
}

/** Lê a trava (pid + porta). Ausente/corrompida/incompleta → null. */
export async function readLock(lockPath: string): Promise<LockInfo | null> {
  try {
    const raw = await readFile(lockPath, "utf-8");
    const parsed = JSON.parse(raw) as LockInfo;
    if (typeof parsed.pid !== "number" || typeof parsed.port !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Grava a trava (pid + porta + início). */
export async function writeLock(lockPath: string, info: LockInfo): Promise<void> {
  await writeFile(lockPath, JSON.stringify(info, null, 2));
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface RunningInstanceDeps {
  lock: LockInfo | null;
  isAlive: (pid: number) => boolean;
  probe: (port: number) => Promise<boolean>;
  firstPort: number;
  maxTries: number;
}

/** Segunda abertura só reabre o navegador: devolve a porta da instância
 * viva (trava viva + saudável primeiro, senão sonda direta na faixa —
 * cobre trava apagada/corrompida) ou null quando nada roda. */
export async function findRunningInstance(deps: RunningInstanceDeps): Promise<number | null> {
  const { lock, isAlive, probe, firstPort, maxTries } = deps;
  if (lock && isAlive(lock.pid) && (await probe(lock.port))) {
    return lock.port;
  }
  for (let port = firstPort; port < firstPort + maxTries; port += 1) {
    if (await probe(port)) return port;
  }
  return null;
}

/** Erro de porta ocupada nos dois runtimes (mensagem do Bun difere da do Node). */
export function isPortBusyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: unknown })?.code;
  if (code === "EADDRINUSE") return true;
  return /EADDRINUSE|address already in use|port.*use/i.test(msg);
}

export interface FirstFreePortOptions<T> {
  firstPort: number;
  maxTries: number;
  start: (port: number) => Promise<T>;
}

/** Sobe na primeira porta livre da faixa; ocupada pula, outro erro propaga. */
export async function startOnFirstFreePort<T>(opts: FirstFreePortOptions<T>): Promise<T> {
  let lastBusy: unknown = null;
  for (let port = opts.firstPort; port < opts.firstPort + opts.maxTries; port += 1) {
    try {
      return await opts.start(port);
    } catch (err) {
      if (!isPortBusyError(err)) throw err;
      lastBusy = err;
    }
  }
  throw lastBusy ?? new Error(`[gestor] nenhuma porta livre entre ${opts.firstPort} e ${opts.firstPort + opts.maxTries - 1}.`);
}
