// Seam do pacote legacy (T5 — Mac antigo, macOS Catalina, darwin-x64).
//
// Manifesto versionado do runtime Node 18 embarcado + verificação por
// checksum. O tarball em si é vendorado FORA do controle de versão
// (`dist/legacy/runtime/`, ignorado pelo git): o que versionamos é só o
// pin (versão + URL + SHA-256 oficial), nunca o binário.
//
// - Linha 18 congelada no último minor (18.20.8, fim de vida aceitável
//   porque o uso é local e offline; o checksum congela a procedência).
// - Arquitetura legada darwin-x64 (Intel): o binário atual quebra na
//   abertura com erro de símbolo do sistema novo; o Node 18 + o driver
//   nativo pinado miram sistema bem mais antigo.
// - Nenhum termo de domínio aqui: glossário (CONTEXT.md) intacto.
export const LEGACY_NODE_VERSION = "18.20.8";
export const LEGACY_NODE_FILE = `node-v${LEGACY_NODE_VERSION}-darwin-x64.tar.gz`;
export const LEGACY_NODE_URL = `https://nodejs.org/dist/v${LEGACY_NODE_VERSION}/${LEGACY_NODE_FILE}`;

/** SHA-256 oficial do tarball (linha do SHASUMS256.txt do nodejs.org). */
export const LEGACY_NODE_SHA256 = "ed2554677188f4afc0d050ecd8bd56effb2572d6518f8da6d40321ede6698509";

/** Compara hex de checksum sem diferenciar maiúscula/minúscula. */
export function verifySha256Hex(actualHex: string, expectedHex: string): boolean {
  return actualHex.trim().toLowerCase() === expectedHex.trim().toLowerCase();
}

/** Extrai o hash de um arquivo na listagem SHASUMS256.txt (ou null). */
export function findChecksumForFile(shasumsText: string, fileName: string): string | null {
  for (const line of shasumsText.split("\n")) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$/);
    if (m && m[2] === fileName) return m[1].toLowerCase();
  }
  return null;
}

/** Pasta de dados no Mac antigo (fora do pacote — atualizar é trocar a pasta). */
export const LEGACY_DARWIN_DATA_DIR_LABEL = "~/Library/Application Support/GestorTrafego";

/** Arquivos que o `scripts/build-legacy.ts` gera dentro de `dist/legacy/`.
 *  Lista testável (seam pública): servidor + migrações + cálculo + lançador
 *  + docs. Banco/backups NUNCA entram aqui (ficam no local padrão do SO). */
export function expectedLegacyLayout(): string[] {
  return [
    "GestorTrafego-legacy.command",
    "Fumaca.command",
    "smoke-legacy.js",
    "server/index.js",
    "server/migrations/001_init.sql",
    "server/migrations/002_domain.sql",
    "server/calc.js",
    "server/runtime/calc.js",
    "shared/calc.js",
    "package.json",
    "LEIA-ME-LEGACY.txt",
    "CHECKLIST-LEGACY.txt",
  ];
}

/** Preâmbulo bash compartilhado pelos lançadores (única fonte do caminho
 * do Node embarcado — sem fallback para `node` do sistema: pacote sem o
 * runtime é pacote incompleto, e o lançador diz isso em vez de fingir). */
export function legacyNodePreamble(): string[] {
  return [
    `PACOTE="$(cd "$(dirname "$0")" && pwd)"`,
    `NODE_EMBARCADO="$PACOTE/runtime/node/bin/node"`,
    `if [ ! -x "$NODE_EMBARCADO" ]; then echo "Runtime Node 18 ausente em $NODE_EMBARCADO — baixe o pacote legacy completo."; exit 1; fi`,
  ];
}

/** Lançador de duplo clique (`.command`) para o Catalina.
 *
 * Duplo clique abre uma janela visível (Terminal) que mostra o endereço
 * (o servidor imprime o `http://127.0.0.1:PORTA` real abaixo — 4173 ou a
 * próxima livre) e a pasta de dados, abre o navegador sozinho
 * e encerra limpo (mata o Node filho ao fechar a janela). Sem instalar
 * nada, sem Terminal digitado, sem admin:
 * - usa SÓ o Node embarcado (`runtime/node/bin/node`); sem ele o lançador
 *   falha com mensagem, nunca usa outro Node;
 * - segunda abertura nunca duplica: o próprio servidor (trava + sonda de
 *   saúde + próxima porta livre) só reabre o navegador. */
export function buildLauncherScript(): string {
  return [
    `#!/bin/bash`,
    `# Gestor de Tráfego Pago (variante legacy Catalina) — duplo clique, sem instalar.`,
    `# Janela visível: mostra o endereço + a pasta de dados. Feche a janela para parar.`,
    `# O servidor abre o navegador sozinho (comando open no Mac; segunda abertura só reabre).`,
    `set -u`,
    ...legacyNodePreamble(),
    `SERVIDOR="$PACOTE/server/index.js"`,
    `DADOS="${LEGACY_DARWIN_DATA_DIR_LABEL}"`,
    ``,
    `if [ ! -f "$SERVIDOR" ]; then echo "Falta $SERVIDOR — baixe o pacote legacy completo."; exit 1; fi`,
    ``,
    `echo "Gestor de Tráfego Pago (legacy Catalina) — 100% offline"`,
    `echo "Pacote: $PACOTE"`,
    `echo "Dados (fora do pacote, não se perdem ao atualizar): $DADOS"`,
    `echo "Endereço: o servidor mostra abaixo (http://127.0.0.1:4173 ou a próxima livre)"`,
    `echo ""`,
    `echo "O navegador abre sozinho. Se já estiver rodando, só reabre o navegador."`,
    `echo "Para parar: feche esta janela (Ctrl+C). Segunda abertura nunca duplica o servidor."`,
    `echo ""`,
    ``,
    `# Encerramento limpo: mata o Node filho (o servidor remove a trava sozinho).`,
    `NODE_PID=""`,
    `trap 'if [ -n "$NODE_PID" ]; then kill "$NODE_PID" 2>/dev/null; fi; exit 0' INT TERM EXIT`,
    `"$NODE_EMBARCADO" "$SERVIDOR" &`,
    `NODE_PID="$!"`,
    `wait "$NODE_PID"`,
    ``,
  ].join("\n");
}
