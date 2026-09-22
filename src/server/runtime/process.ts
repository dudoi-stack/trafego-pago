// Seam de processo filho (T1 — porte Node 18).
//
// A abertura do navegador é fire-and-forget via `node:child_process`, que
// existe idêntica no Bun e no Node 18 — por isso a variante Node reutiliza
// este módulo sem troca. Nenhum ponto do domínio importa `Bun.spawn`.
import { spawn } from "node:child_process";

/** Dispara um processo destacado sem segurar o servidor (sem output, sem throw). */
export function spawnDetached(command: string, args: string[]): void {
  try {
    const child = spawn(command, args, { stdio: "ignore", detached: true, shell: false });
    child.unref?.();
    child.on?.("error", () => {});
  } catch {
    // Ambiente sem UI (CI): silencioso — o chamador loga se precisar.
  }
}
