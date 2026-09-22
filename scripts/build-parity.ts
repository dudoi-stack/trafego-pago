// scripts/build-parity.ts — T4 Paridade de testes nos dois runtimes.
//
// Compilação antes do runner Node: transpila a mesma fonte (src + 6 arquivos
// de domínio + shim) para `dist/parity/` em JS estático, sem dependências.
// O runner nativo do Node (`node --test`) executa o JS; o runner padrão
// (`bun test`) executa o TS direto — mesmos 71 cenários, mesmas asserções.
//
// Uso:
//   bun run build:parity   # gera dist/parity + dist/calc.js
//   bun run test:node      # build + node --test (71 cenários no Node)
//   bun run test:parity    # 71 no Bun + 71 no Node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outRoot = join(root, "dist", "parity");

// Fonte única: os 6 arquivos de domínio (71 cenários) + shim fino.
// (Lista espelhada em `test:node` e `test:parity:bun` no package.json —
// manter em sync. A trava abaixo quebra o build se um 7º `tests/*.test.ts`
// aparecer sem classificação explícita.)
const PARITY_TESTS = ["api.test.ts", "calc.test.ts", "t3.test.ts", "t4.test.ts", "t5.test.ts", "t6.test.ts"];
// Detalhe de runtime, fora da paridade (verificam seams/drivers, não HTTP+estado).
const RUNTIME_ONLY_TESTS = ["seams.test.ts", "t2-persist-node.test.ts", "t3-boot-node.test.ts", "legacy-package.test.ts"];
{
  const found = (await readdir(join(root, "tests"))).filter((f) => f.endsWith(".test.ts")).sort();
  const expected = [...PARITY_TESTS, ...RUNTIME_ONLY_TESTS].sort();
  if (JSON.stringify(found) !== JSON.stringify(expected)) {
    throw new Error(
      `[build:parity] tests/*.test.ts fora do esperado — classifica o novo arquivo em PARITY_TESTS ou RUNTIME_ONLY_TESTS. Achado: ${found.join(", ")}`,
    );
  }
}

type BunTranspiler = new (o: unknown) => { transformSync(s: string, l: string): string };

function getTranspiler(): BunTranspiler {
  // A compilação roda no Bun (dev/CI) antes do runner Node — o host legacy
  // nunca precisa transpilar, só executar o JS em `dist/parity/`.
  const bunGlobal = globalThis as unknown as { Bun?: { Transpiler: BunTranspiler } };
  if (bunGlobal.Bun == null) throw new Error("build:parity exige Bun (Transpiler) — rode com `bun run build:parity`");
  return bunGlobal.Bun.Transpiler;
}

async function listTsFiles(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) out.push(...(await listTsFiles(full, base)));
    else out.push(relative(base, full));
  }
  return out;
}

function rewriteTsToJs(js: string): string {
  // from "... .ts" / import("... .ts") / export ... from "... .ts" → .js
  return js
    .replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2")
    .replace(/(import\s*\(\s*["'][^"']+)\.ts(["']\s*\))/g, "$1.js$2")
    .replace(/(export\s+[^;]*?from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
}

async function transpileFile(srcPath: string, destPath: string): Promise<void> {
  const src = await readFile(srcPath, "utf-8");
  let js = new (getTranspiler())({ loader: "ts" }).transformSync(src, "ts");
  js = rewriteTsToJs(js);
  await mkdir(dirname(destPath), { recursive: true });
  await writeFile(destPath, js);
}

const srcDir = join(root, "src");
const testDir = join(root, "tests");
const srcFiles = (await listTsFiles(srcDir, root)).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));
const supportFiles = (await listTsFiles(join(testDir, "support"), root)).filter((f) => f.endsWith(".ts"));
const parityFiles = PARITY_TESTS.map((f) => join("tests", f));

function destFor(rel: string): string {
  // Testes compilados perdem o `.test` (`api.test.ts` → `api.js`) para que
  // o `bun test` (descoberta por `*.test.*`) não execute o build — só a fonte.
  // O `node --test` chama os caminhos explícitos, então o nome não importa.
  // (Windows: `relative` usa `\` — por isso só olhamos o sufixo.)
  if (rel.endsWith(".test.ts")) {
    return join(outRoot, rel.replace(/\.test\.ts$/, ".js"));
  }
  return join(outRoot, rel.replace(/\.ts$/, ".js"));
}

const parityRelPaths = [...srcFiles, ...supportFiles, ...parityFiles];
let count = 0;
for (const rel of parityRelPaths) {
  const srcPath = join(root, rel);
  await transpileFile(srcPath, destFor(rel));
  count += 1;
}

// Artefato de cálculo para o loader no Node (mesmo de `bun run build:calc`:
// o loader prefere `dist/calc.js`; sem ele cairia no CALC_JS embutido e o
// Node testaria o fallback, não o artefato real).
{
  const calcSrc = await readFile(join(root, "src", "shared", "calc.ts"), "utf-8");
  const js = new (getTranspiler())({ loader: "ts" }).transformSync(calcSrc, "ts");
  if (!js.includes("costOf") || !js.includes("evaluateCreative")) {
    throw new Error("[build:parity] artefato calc sem costOf/evaluateCreative — abortando");
  }
  await mkdir(join(root, "dist"), { recursive: true });
  await writeFile(join(root, "dist", "calc.js"), js);
}

// Trava: nenhum JS compilado pode importar runtime do Bun —
// a paridade verifica comportamento externo (HTTP + estado persistido),
// nunca detalhes de runtime. Comentários podem citar os nomes.
for (const rel of parityRelPaths) {
  const js = await readFile(destFor(rel), "utf-8");
  const bad = /from\s+["']bun:(test|sqlite)["']|import\s*\(\s*["']bun:(test|sqlite)["']/.test(js);
  if (bad) throw new Error(`[build:parity] ${rel} ainda importa bun:* — use a seam/tests/support/parity.ts`);
}

console.log(`[build:parity] ${count} arquivo(s) em dist/parity (+ dist/calc.js) — 71 cenários, fonte única`);
