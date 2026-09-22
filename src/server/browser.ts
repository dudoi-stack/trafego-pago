import { spawnDetached } from "./runtime/process.ts";

/** Abre o navegador do SO sem travar o servidor. Falha silenciosa em headless/CI. */
export async function openBrowser(url: string): Promise<void> {
  if (process.env.GESTOR_NO_BROWSER === "1") return;
  try {
    if (process.platform === "win32") {
      spawnDetached("cmd", ["/c", "start", "", url]);
    } else if (process.platform === "darwin") {
      spawnDetached("open", [url]);
    } else {
      spawnDetached("xdg-open", [url]);
    }
  } catch {
    // Ambiente sem UI (CI): só loga.
    console.warn(`[gestor] não foi possível abrir o navegador em ${url}`);
  }
}
