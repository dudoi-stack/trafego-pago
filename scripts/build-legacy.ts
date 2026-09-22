// scripts/build-legacy.ts — T5 Pacote legacy Catalina (duplo clique, sem instalar).
//
// Build SEPARADO do executável padrão (`scripts/build.ts`, intocado).
// Emissão TypeScript pelo mesmo pipeline do repo (T2/T4): `Bun.Transpiler`
// transpila a fonte (`src/`) para JS estático (reescrita `.ts`→`.js`, sem
// dependências além de `better-sqlite3` pinado) — o `tsc --noEmit`
// (`bun run typecheck`) continua travando os tipos antes do release.
// - embarca migrações `.sql` ao lado do servidor + artefato `calc.js`
//   (o loader prefere o artefato; sem ele cai no CALC_JS embutido);
// - gera lançadores de duplo clique (`GestorTrafego-legacy.command`,
//   `Fumaca.command`) com bit de execução;
// - gera `LEIA-ME-LEGACY.txt` + `CHECKLIST-LEGACY.txt` da fonte única
//   (`src/server/leia-me.ts`);
// - garante o runtime Node 18.20.8 darwin-x64 embarcado e VERIFICADO
//   (SHA-256 conferido contra o SHASUMS256.txt oficial + pin versionado),
//   vendorado fora do controle de versão (`dist/`, ignorado).
//
// Uso: bun run build:legacy  (rede só para baixar o Node + SHASUMS).
//   --skip-runtime monta um pacote INCOMPLETO só para iteração em dev
//   (não distribuir: sem o binário verificado não há duplo clique offline).
import { chmod, copyFile, mkdir, readFile, rename, readdir, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChecklistLegacy, buildLeiaMeLegacy } from "../src/server/leia-me.ts";
import {
  LEGACY_NODE_FILE,
  LEGACY_NODE_SHA256,
  LEGACY_NODE_URL,
  LEGACY_NODE_VERSION,
  buildLauncherScript,
  findChecksumForFile,
  legacyNodePreamble,
} from "../src/server/runtime/legacy.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const outRoot = join(root, "dist", "legacy");
const serverOut = join(outRoot, "server");
const runtimeDir = join(outRoot, "runtime");
const nodeBin = join(runtimeDir, "node", "bin", "node");

const SKIP_RUNTIME = process.argv.includes("--skip-runtime") || process.env.GESTOR_SKIP_NODE_DOWNLOAD === "1";

function sha256Hex(buf: Uint8Array): string {
  return createHash("sha256").update(buf).digest("hex");
}

async function ensureRuntime(): Promise<void> {
  if (existsSync(nodeBin)) {
    console.log(`[build:legacy] runtime já embarcado: ${nodeBin}`);
    return;
  }
  if (SKIP_RUNTIME) {
    console.warn("[build:legacy] INCOMPLETO (--skip-runtime, só dev): sem o Node verificado não há duplo clique offline — não distribuir assim.");
    return;
  }
  // O pin versionado vale contra a lista oficial: baixa o SHASUMS256.txt e
  // confirma que o SHA do manifesto é o publicado pelo nodejs.org.
  console.log("[build:legacy] conferindo o pin contra o SHASUMS256.txt oficial…");
  const shasumsUrl = `https://nodejs.org/dist/v${LEGACY_NODE_VERSION}/SHASUMS256.txt`;
  const shasumsRes = await fetch(shasumsUrl);
  if (!shasumsRes.ok) throw new Error(`[build:legacy] SHASUMS indisponível: HTTP ${shasumsRes.status} em ${shasumsUrl}`);
  const official = findChecksumForFile(await shasumsRes.text(), LEGACY_NODE_FILE);
  if (official == null) throw new Error(`[build:legacy] ${LEGACY_NODE_FILE} sumiu do SHASUMS oficial — abortando`);
  if (official !== LEGACY_NODE_SHA256) {
    throw new Error(`[build:legacy] pin desatualizado: manifesto ${LEGACY_NODE_SHA256} ≠ oficial ${official} — atualize src/server/runtime/legacy.ts`);
  }
  console.log("[build:legacy] pin confere com o SHASUMS oficial");
  await mkdir(runtimeDir, { recursive: true });
  const tarPath = join(runtimeDir, LEGACY_NODE_FILE);
  if (!existsSync(tarPath)) {
    console.log(`[build:legacy] baixando Node ${LEGACY_NODE_VERSION} darwin-x64…`);
    const res = await fetch(LEGACY_NODE_URL);
    if (!res.ok) throw new Error(`[build:legacy] download falhou: HTTP ${res.status} em ${LEGACY_NODE_URL}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    const got = sha256Hex(buf);
    if (got !== LEGACY_NODE_SHA256) {
      throw new Error(`[build:legacy] checksum divergiu: esperado ${LEGACY_NODE_SHA256}, obtido ${got} — abortando`);
    }
    await writeFile(tarPath, buf);
    console.log(`[build:legacy] checksum OK (${LEGACY_NODE_FILE})`);
  } else {
    const buf = await readFile(tarPath);
    const got = sha256Hex(new Uint8Array(buf));
    if (got !== LEGACY_NODE_SHA256) {
      throw new Error(`[build:legacy] tarball local com checksum divergente — apague ${tarPath} e rode de novo`);
    }
    console.log(`[build:legacy] tarball local verificado (${LEGACY_NODE_FILE})`);
  }
  // Extrai (tar do SO; no Mac alvo é o tar do sistema, sem instalar nada).
  const extracted = join(runtimeDir, `node-v${LEGACY_NODE_VERSION}-darwin-x64`);
  if (!existsSync(nodeBin)) {
    console.log("[build:legacy] extraindo runtime…");
    const r = spawnSync("tar", ["-xzf", tarPath, "-C", runtimeDir], { stdio: "inherit" });
    if (r.status !== 0) throw new Error("[build:legacy] `tar` falhou — pacote sem runtime é INCOMPLETO, abortando");
  }
  const finalDir = join(runtimeDir, "node");
  if (!existsSync(finalDir) && existsSync(extracted)) {
    await rename(extracted, finalDir).catch(() => {});
  }
  if (!existsSync(nodeBin)) throw new Error("[build:legacy] binário do Node não apareceu após extrair — abortando");
  if (process.platform !== "win32") await chmod(nodeBin, 0o755).catch(() => {});
  console.log(`[build:legacy] runtime OK: ${nodeBin}`);
}

type BunTranspiler = new (o: unknown) => { transformSync(s: string, l: string): string };

function getTranspiler(): BunTranspiler {
  const g = globalThis as unknown as { Bun?: { Transpiler: BunTranspiler } };
  if (g.Bun == null) throw new Error("build:legacy exige Bun (Transpiler) — rode com `bun run build:legacy`");
  return g.Bun.Transpiler;
}

function rewriteTsToJs(js: string): string {
  return js
    .replace(/(from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2")
    .replace(/(import\s*\(\s*["'][^"']+)\.ts(["']\s*\))/g, "$1.js$2")
    .replace(/(export\s+[^;]*?from\s+["'][^"']+)\.ts(["'])/g, "$1.js$2");
}

async function transpileTree(srcDir: string, destDir: string): Promise<number> {
  async function list(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const e of await readdir(dir)) {
      const full = join(dir, e);
      const st = await stat(full);
      if (st.isDirectory()) out.push(...(await list(full)));
      else if (full.endsWith(".ts") && !full.endsWith(".d.ts")) out.push(full);
    }
    return out;
  }
  const files = await list(srcDir);
  let n = 0;
  for (const src of files) {
    const rel = relative(srcDir, src).replace(/\.ts$/, ".js");
    const dest = join(destDir, rel);
    const code = await readFile(src, "utf-8");
    const js = rewriteTsToJs(new (getTranspiler())({ loader: "ts" }).transformSync(code, "ts"));
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, js);
    n += 1;
  }
  return n;
}

function buildFumacaCommand(): string {
  return [
    `#!/bin/bash`,
    `# Fumaça do pacote legacy — duplo clique, cole o resultado no suporte.`,
    `# Com o app aberto lê os caminhos reais; fechado roda um ciclo isolado.`,
    `set -u`,
    ...legacyNodePreamble(),
    `SMOKE="$PACOTE/smoke-legacy.js"`,
    `"$NODE_EMBARCADO" "$SMOKE" "$@"`,
    `echo ""`,
    `echo "Copie o texto acima e cole no suporte."`,
    `read -p "Enter para fechar…" _`,
    ``,
  ].join("\n");
}

// 0) Assets embutidos + cálculo frescos (mesma fonte do padrão).
{
  const { $ } = await import("bun");
  await $`bun run scripts/embed-assets.ts`.quiet();
  await $`bun run scripts/build-calc.ts`.quiet();
}

const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf-8")) as { version?: string };
const version = process.env.npm_package_version ?? pkg.version ?? "0.1.0";

await mkdir(serverOut, { recursive: true });

// 1) Servidor transpilado (fonte única, sem reescrever domínio).
// Espelha `src/` em `dist/legacy/`: `src/server/*` → `server/*`,
// `src/shared/*` → `shared/*` (o `../shared/calc.js` do servidor continua
// válido: sobe de `server/` para a raiz do pacote e entra em `shared/`).
const nServer = await transpileTree(join(root, "src", "server"), join(outRoot, "server"));
const nShared = await transpileTree(join(root, "src", "shared"), join(outRoot, "shared"));
// Smoke CLI no topo do pacote (`smoke-legacy.js`): reescreve os imports de
// `scripts/` (`../src/server/*`, `../src/shared/*`) para o layout do pacote
// (`./server/*`, `./shared/*`).
{
  const smokeSrc = await readFile(join(root, "scripts", "smoke-legacy.ts"), "utf-8");
  let js = new (getTranspiler())({ loader: "ts" }).transformSync(smokeSrc, "ts");
  js = js
    .replace(/\.\.\/src\/server\//g, "./server/")
    .replace(/\.\.\/src\/shared\//g, "./shared/");
  js = rewriteTsToJs(js);
  await writeFile(join(outRoot, "smoke-legacy.js"), js);
}
console.log(`[build:legacy] ${nServer + nShared} módulo(s) (server+shared) + smoke-legacy.js`);

// 2) Migrações ao lado do servidor (o loader lê do arquivo no boot).
await mkdir(join(serverOut, "migrations"), { recursive: true });
await copyFile(join(root, "src", "server", "migrations", "001_init.sql"), join(serverOut, "migrations", "001_init.sql"));
await copyFile(join(root, "src", "server", "migrations", "002_domain.sql"), join(serverOut, "migrations", "002_domain.sql"));

// 3) Cálculo ao-vivo (artefato + cópias nos candidatos do loader).
{
  const calc = await readFile(join(root, "dist", "calc.js"), "utf-8");
  if (!calc.includes("costOf") || !calc.includes("evaluateCreative")) {
    throw new Error("[build:legacy] dist/calc.js inválido — abortando (cálculo ao-vivo quebraria)");
  }
  await writeFile(join(serverOut, "calc.js"), calc);
  await mkdir(join(serverOut, "runtime"), { recursive: true });
  await writeFile(join(serverOut, "runtime", "calc.js"), calc);
}

// 4) package.json do pacote (só o driver nativo pinado; sem tooling de dev).
await writeFile(
  join(outRoot, "package.json"),
  JSON.stringify(
    {
      name: "gestor-trafego-legacy",
      version,
      private: true,
      type: "module",
      description: "Gestor de Tráfego Pago — variante legacy Catalina (Node 18, offline, duplo clique)",
      engines: { node: "18.x" },
      dependencies: { "better-sqlite3": "11.10.0" },
    },
    null,
    2,
  ) + "\n",
);

// 5) Lançadores de duplo clique (com bit de execução).
// O duplo clique no Finder exige o bit 755: no Mac/Linux o chmod aplica na
// hora; no Windows (dev) o bit não existe — o release (tar/zip gerado no
// Mac ou com `git add --chmod=+x`) deve garantir o 755 antes de distribuir.
await writeFile(join(outRoot, "GestorTrafego-legacy.command"), buildLauncherScript());
await writeFile(join(outRoot, "Fumaca.command"), buildFumacaCommand());
await chmod(join(outRoot, "GestorTrafego-legacy.command"), 0o755).catch(() => {});
await chmod(join(outRoot, "Fumaca.command"), 0o755).catch(() => {});
{
  const { stat: statExec } = await import("node:fs/promises");
  const isExec = async (p: string) => {
    try {
      return ((await statExec(p)).mode & 0o111) !== 0;
    } catch {
      return false;
    }
  };
  const ok1 = await isExec(join(outRoot, "GestorTrafego-legacy.command"));
  const ok2 = await isExec(join(outRoot, "Fumaca.command"));
  if (process.platform === "win32" && (!ok1 || !ok2)) {
    console.warn("[build:legacy] Windows não grava bit 755: antes de distribuir, rode `chmod +x *.command` no Mac.");
  } else if (!ok1 || !ok2) {
    throw new Error("[build:legacy] .command sem bit de execução — duplo clique falharia; abortando");
  }
  console.log("[build:legacy] .command com bit de execução OK");
}

// 6) Textos da fonte única (LEIA-ME + checklist de aceite).
await writeFile(join(outRoot, "LEIA-ME-LEGACY.txt"), buildLeiaMeLegacy(version));
await writeFile(join(outRoot, "CHECKLIST-LEGACY.txt"), buildChecklistLegacy());
console.log("[build:legacy] LEIA-ME-LEGACY.txt + CHECKLIST-LEGACY.txt OK");

// 7) Runtime Node embarcado e verificado (fora do controle de versão).
await ensureRuntime();

console.log(`[build:legacy] pacote legacy v${version} em dist/legacy — dados ficam em ~/Library/Application Support/GestorTrafego (fora do pacote)`);
