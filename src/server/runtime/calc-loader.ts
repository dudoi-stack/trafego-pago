// Seam de cálculo (T1 — porte Node 18).
//
// O JS servido ao navegador em `/shared/calc.js` (cálculo ao-vivo, offline)
// passa por este módulo. Adapter atual: lê `src/shared/calc.ts` e transpila
// ao vivo com Bun, caindo para o `CALC_JS` embutido quando a fonte não está
// ao lado do executável (`bun build --compile`). A variante Node (T2) troca
// o corpo por leitura do artefato compilado em tempo de build, caindo para
// o mesmo embutido — o chamador (`app.ts`) não muda.
import { CALC_JS } from "../assets.ts";

export interface CalcLoader {
  get(): Promise<string>;
}

/** Cria o loader com cache de boot (mesma semântica do `getCalcJs` original). */
export function createCalcLoader(): CalcLoader {
  let cached: string | null = null;
  async function get(): Promise<string> {
    if (cached != null) return cached;
    try {
      const src = await Bun.file(new URL("../../shared/calc.ts", import.meta.url)).text();
      cached = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
      return cached;
    } catch {
      // Executável sem fonte ao lado: usa o bundle embutido pelo embed.
      if (CALC_JS) {
        cached = CALC_JS;
        return cached;
      }
      throw new Error("calc_indisponivel");
    }
  }
  return { get };
}
