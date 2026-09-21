import { mkdir, writeFile } from "node:fs/promises";
import { $ } from "bun";

await $`bun run scripts/embed-assets.ts`;

await mkdir("dist", { recursive: true });

const entry = "src/server/index.ts";
const version = process.env.npm_package_version ?? "0.1.0";
console.log(`[build] Gestor de Tráfego Pago v${version} — compilando executáveis…`);

// Windows x64 (uso principal do criador)
await $`bun build --compile --minify --target=bun-windows-x64 --outfile=dist/GestorTrafego.exe ${entry}`;
console.log("[build] dist/GestorTrafego.exe OK");

// macOS arm64 + x64 (v1 é Win+Mac)
await $`bun build --compile --minify --target=bun-darwin-arm64 --outfile=dist/GestorTrafego-macos-arm64 ${entry}`;
console.log("[build] dist/GestorTrafego-macos-arm64 OK");
await $`bun build --compile --minify --target=bun-darwin-x64 --outfile=dist/GestorTrafego-macos-x64 ${entry}`;
console.log("[build] dist/GestorTrafego-macos-x64 OK");

await writeFile(
  "dist/LEIA-ME.txt",
  [
    "Gestor de Tráfego Pago — como abrir (3 passos)",
    "",
    "1. Dê dois cliques em GestorTrafego.exe (Windows) ou GestorTrafego-macos-arm64 (Mac).",
    "2. O navegador abre sozinho no painel. Se o Windows mostrar 'O Windows protegeu o computador',",
    "   clique em 'Mais informações' e depois em 'Executar assim mesmo' (programa sem assinatura no v1).",
    "   No Mac, se bloquear: clique com o botão direito no app e escolha 'Abrir'.",
    "3. Se o programa já estiver aberto, clicar de novo só abre o navegador (não duplica).",
    "",
    "Onde ficam os dados:",
    "- Windows: %APPDATA%\\GestorTrafego\\gestor.db",
    "- Mac: ~/Library/Application Support/GestorTrafego/gestor.db",
    "Para trocar de computador, feche o programa antes. Para atualizar, troque só o executável.",
    "",
  ].join("\n"),
);
console.log("[build] dist/LEIA-ME.txt OK");
