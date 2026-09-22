// scripts/build-calc.ts — T2 (variante Node legacy).
// Gera `dist/calc.js`: o módulo único `src/shared/calc.ts` transpilado para
// JavaScript estático, sem dependências. A variante Node serve esse artefato
// em `/shared/calc.js` (cálculo ao-vivo offline); se o artefato não estiver
// ao lado do servidor, o loader cai para o CALC_JS embutido em assets.ts.
// Uso: bun run build:calc
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const srcPath = join(root, "src", "shared", "calc.ts");
const outPath = join(root, "dist", "calc.js");

const src = await readFile(srcPath, "utf-8");
let js: string;
try {
  const g = globalThis as unknown as {
    Bun?: { Transpiler: new (o: unknown) => { transformSync(s: string, l: string): string } };
  };
  if (g.Bun == null) throw new Error("build:calc exige Bun (Transpiler)");
  js = new g.Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
} catch (err) {
  console.error(`[build:calc] falha ao transpilar ${srcPath}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

if (!js.includes("costOf") || !js.includes("evaluateCreative")) {
  console.error("[build:calc] artefato sem costOf/evaluateCreative — abortando (cálculo ao-vivo quebraria)");
  process.exit(1);
}

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, js);
console.log(`[build:calc] ${outPath} OK (${js.length} bytes)`);
