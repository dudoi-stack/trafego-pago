// Seam de espera (T1 — porte Node 18).
//
// `sleep` e `fetchWithTimeout` usam só APIs presentes no Bun e no Node 18
// (`setTimeout`, `fetch`, `AbortSignal.timeout`). A variante Node reutiliza
// este mesmo módulo sem troca — a seam existe para que nenhum ponto do
// domínio precise importar primitivas de espera do runtime diretamente.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  return fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
}
