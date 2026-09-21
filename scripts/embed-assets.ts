import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIR = new URL("../src/web/", import.meta.url);
const OUT_FILE = new URL("../src/server/assets.ts", import.meta.url);

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function walk(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(relative(base, full));
  }
  return out;
}

function contentTypeFor(file: string): string {
  return CONTENT_TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
}

const webPath = fileURLToPath(WEB_DIR);
const relFiles = await walk(webPath, webPath);

const entries: string[] = [];
for (const rel of relFiles.sort()) {
  const content = await readFile(join(webPath, rel));
  const isText = ![".png", ".woff2"].includes(extname(rel).toLowerCase());
  const body = isText
    ? JSON.stringify(content.toString("utf-8"))
    : `Buffer.from(${JSON.stringify(content.toString("base64"))}, "base64")`;
  entries.push(
    `  ${JSON.stringify(rel.replace(/\\/g, "/"))}: { contentType: ${JSON.stringify(contentTypeFor(rel))}, text: ${isText ? body : "undefined"}, binary: ${isText ? "undefined" : body} },`,
  );
}

const indexRaw = await readFile(join(webPath, "index.html"), "utf-8").catch(() => "<h1>Gestor</h1>");

// T6: módulo único de cálculo transpilado e embutido no exe.
// Em dev o servidor transpila ao vivo (fresco); no executável
// (`bun build --compile`) não há fonte ao lado — o fallback é este bundle.
let calcJs = "";
try {
  const calcSrc = await readFile(new URL("../src/shared/calc.ts", import.meta.url), "utf-8");
  calcJs = new Bun.Transpiler({ loader: "ts" }).transformSync(calcSrc, "ts");
} catch (err) {
  console.warn(`[embed] aviso: não foi possível transpilar calc.ts: ${err instanceof Error ? err.message : String(err)}`);
}

const out = `// GERADO por scripts/embed-assets.ts — não edite à mão. Rode \`bun run embed\`.
export interface EmbeddedAsset { contentType: string; text?: string; binary?: Buffer }
export const assets: Record<string, EmbeddedAsset> = {
${entries.join("\n")}
};
export const INDEX_HTML: string = ${JSON.stringify(indexRaw)};
export const APP_VERSION = ${JSON.stringify(process.env.npm_package_version ?? "0.1.0")};
// T6: bundle do módulo único de cálculo (fallback offline no executável).
export const CALC_JS: string = ${JSON.stringify(calcJs)};
`;
await writeFile(fileURLToPath(OUT_FILE), out);
console.log(`[embed] ${relFiles.length} arquivo(s) da web embutido(s) em src/server/assets.ts`);
