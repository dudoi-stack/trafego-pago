// Seam de cálculo (T1 — porte Node 18; T2 — artefato compilado).
//
// O JS servido ao navegador em `/shared/calc.js` (cálculo ao-vivo, offline)
// passa por este módulo, sempre com cache de boot.
// - Padrão Bun (dev): transpila `src/shared/calc.ts` ao vivo (fresco).
// - Variante Node (T2): lê o artefato `dist/calc.js` gerado em tempo de
//   build (`bun run build:calc`), sem transpilar em runtime.
// - Fallback (exe sem fonte/artefato ao lado): `CALC_JS` embutido pelo embed.
// O chamador (`app.ts`) não muda em nenhum runtime.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CALC_JS } from "../assets.ts";

export interface CalcLoader {
  get(): Promise<string>;
}

/** Candidatos do artefato compilado (ordem de tentativa). */
export function calcArtifactCandidates(): string[] {
  const out: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Legado: artefato ao lado do runtime compilado.
    out.push(join(here, "calc.js"));
    // Dev: dist/ na raiz do repo.
    out.push(join(here, "..", "..", "..", "dist", "calc.js"));
  } catch {
    // segue para cwd
  }
  out.push(join(process.cwd(), "dist", "calc.js"));
  return out;
}

/** Guarda do artefato: precisa ser o módulo único (não um JS qualquer). */
export function isValidCalcJs(txt: string): boolean {
  return txt.includes("costOf") && txt.includes("evaluateCreative");
}

/** Lê o artefato compilado (ou null se ausente/inválido). Exportado p/ testes. */
export async function readCalcArtifact(): Promise<string | null> {
  for (const p of calcArtifactCandidates()) {
    try {
      const txt = await readFile(p, "utf-8");
      if (isValidCalcJs(txt)) return txt;
    } catch {
      // próximo candidato
    }
  }
  return null;
}

async function transpileLiveBun(): Promise<string | null> {
  try {
    const g = globalThis as unknown as {
      Bun?: { file(p: unknown): { text(): Promise<string> }; Transpiler: new (o: unknown) => { transformSync(s: string, l: string): string } };
    };
    if (g.Bun == null) return null;
    const src = await g.Bun.file(new URL("../../shared/calc.ts", import.meta.url)).text();
    const js = new g.Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
    return js.includes("costOf") ? js : null;
  } catch {
    return null;
  }
}

/** Cria o loader com cache de boot (mesma semântica do `getCalcJs` original). */
export function createCalcLoader(): CalcLoader {
  let cached: string | null = null;
  async function get(): Promise<string> {
    if (cached != null) return cached;
    // 1) Ao vivo no Bun (dev, fresco).
    const live = await transpileLiveBun();
    if (live != null) {
      cached = live;
      return cached;
    }
    // 2) Artefato compilado no build (variante Node legacy).
    const artifact = await readCalcArtifact();
    if (artifact != null) {
      cached = artifact;
      return cached;
    }
    // 3) Embutido pelo embed (exe sem nada ao lado, 100% offline).
    if (CALC_JS) {
      cached = CALC_JS;
      return cached;
    }
    throw new Error("calc_indisponivel");
  }
  return { get };
}
