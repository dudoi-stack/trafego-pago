import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { $ } from "bun";
import { buildLeiaMe } from "../src/server/leia-me.ts";

await $`bun run scripts/embed-assets.ts`;

await mkdir("dist", { recursive: true });

const entry = "src/server/index.ts";
const pkg = JSON.parse(await readFile("package.json", "utf-8")) as { version?: string };
const version = process.env.npm_package_version ?? pkg.version ?? "0.1.0";
console.log(`[build] Gestor de Tráfego Pago v${version} — compilando executáveis…`);

// Trava offline T6: nenhum asset embutido pode puxar CDN/fonte remota.
// Espelha o teste tests/t6.test.ts (hosts + <link>/<script> externos).
{
  const assetsSrc = await readFile("src/server/assets.ts", "utf-8");
  const blockedRemoteHosts = ["fonts.googleapis.com", "fonts.gstatic.com", "unpkg.com", "jsdelivr", "cdn."];
  for (const host of blockedRemoteHosts) {
    if (assetsSrc.includes(host)) {
      throw new Error(`[build] asset embutido referencia ${host} — v1 é 100% offline`);
    }
  }
  if (/<link[^>]+href="https?:\/\//.test(assetsSrc) || /<script[^>]+src="https?:\/\//.test(assetsSrc)) {
    throw new Error("[build] asset embutido com <link>/<script> externo — v1 é 100% offline");
  }
  if (assetsSrc.includes('export const CALC_JS: string = "";')) {
    throw new Error("[build] CALC_JS vazio — o exe ficaria sem cálculo ao-vivo offline");
  }
}

// Windows x64 (uso principal do criador)
await $`bun build --compile --minify --target=bun-windows-x64 --outfile=dist/GestorTrafego.exe ${entry}`;
console.log("[build] dist/GestorTrafego.exe OK");

// macOS arm64 + x64 (v1 é Win+Mac)
await $`bun build --compile --minify --target=bun-darwin-arm64 --outfile=dist/GestorTrafego-macos-arm64 ${entry}`;
console.log("[build] dist/GestorTrafego-macos-arm64 OK");
await $`bun build --compile --minify --target=bun-darwin-x64 --outfile=dist/GestorTrafego-macos-x64 ${entry}`;
console.log("[build] dist/GestorTrafego-macos-x64 OK");

// Duplo clique no Mac exige bit de execução no Finder/Terminal.
await chmod("dist/GestorTrafego-macos-arm64", 0o755);
await chmod("dist/GestorTrafego-macos-x64", 0o755);

await writeFile("dist/LEIA-ME.txt", buildLeiaMe(version));
console.log("[build] dist/LEIA-ME.txt OK");
