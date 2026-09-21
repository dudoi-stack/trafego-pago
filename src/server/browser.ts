/** Abre o navegador do SO sem travar o servidor. Falha silenciosa em headless/CI. */
export async function openBrowser(url: string): Promise<void> {
  if (process.env.GESTOR_NO_BROWSER === "1") return;
  try {
    if (process.platform === "win32") {
      Bun.spawn(["cmd", "/c", "start", "", url], {
        stdio: ["ignore", "ignore", "ignore"],
      });
    } else if (process.platform === "darwin") {
      Bun.spawn(["open", url], { stdio: ["ignore", "ignore", "ignore"] });
    } else {
      Bun.spawn(["xdg-open", url], { stdio: ["ignore", "ignore", "ignore"] });
    }
  } catch {
    // Ambiente sem UI (CI): só loga.
    console.warn(`[gestor] não foi possível abrir o navegador em ${url}`);
  }
}
