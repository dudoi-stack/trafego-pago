// Seam de ambiente (T3 — porte Node 18).
//
// Uma só leitura de "qual runtime é este", compartilhada pelas seams que
// precisam despachar (persistência, HTTP). Evita o `isBunRuntime` duplicado
// por módulo: a pergunta é a mesma, a resposta é a mesma.
export function isBunRuntime(): boolean {
  return typeof (globalThis as unknown as { Bun?: unknown }).Bun !== "undefined";
}

/** Há `Bun.serve` disponível (servidor HTTP do padrão)? */
export function hasBunServe(): boolean {
  const g = globalThis as unknown as { Bun?: { serve?: unknown } };
  return typeof g.Bun?.serve === "function";
}
