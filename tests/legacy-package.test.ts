import { describe, expect, test } from "bun:test";
import {
  LEGACY_NODE_FILE,
  LEGACY_NODE_SHA256,
  LEGACY_NODE_URL,
  LEGACY_NODE_VERSION,
  buildLauncherScript,
  expectedLegacyLayout,
  findChecksumForFile,
  legacyNodePreamble,
  verifySha256Hex,
} from "../src/server/runtime/legacy.ts";
import { LEGACY_SQLITE_DRIVER } from "../src/server/runtime/database.ts";
import { formatSmokeReport, collectSmoke, findHealthyBase } from "../src/server/runtime/smoke.ts";
import { buildLeiaMeLegacy, buildChecklistLegacy } from "../src/server/leia-me.ts";
import { startServer } from "../src/server/app.ts";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// T5 (pacote legacy Catalina) — slice 1: runtime Node 18 pinado + checksum.
// Seam pública: manifesto versionado (versão+URL+checksum) + verificação,
// com o tarball vendorado fora do controle de versão (dist/, não git).
describe("T5 legacy — runtime Node 18 pinado e verificado", () => {
  test("manifesto congela a linha 18 (último minor) para darwin-x64", () => {
    expect(LEGACY_NODE_VERSION).toBe("18.20.8");
    expect(LEGACY_NODE_FILE).toBe("node-v18.20.8-darwin-x64.tar.gz");
    expect(LEGACY_NODE_URL).toBe("https://nodejs.org/dist/v18.20.8/node-v18.20.8-darwin-x64.tar.gz");
  });

  test("checksum oficial do tarball (SHASUMS256.txt do nodejs.org)", () => {
    expect(LEGACY_NODE_SHA256).toBe("ed2554677188f4afc0d050ecd8bd56effb2572d6518f8da6d40321ede6698509");
    expect(LEGACY_NODE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  test("driver SQLite legacy continua pinado (mesmo arquivo, sem migração)", () => {
    expect(LEGACY_SQLITE_DRIVER).toBe("better-sqlite3@11.10.0");
  });

  test("verifySha256Hex compara sem diferenciar maiúscula/minúscula", () => {
    expect(verifySha256Hex("ABCD", "abcd")).toBe(true);
    expect(verifySha256Hex("abcd", "abce")).toBe(false);
  });

  test("findChecksumForFile extrai o hash do SHASUMS oficial", () => {
    const shasums = [
      "bae4965d29d29bd32f96364eefbe3bca576a03e917ddbb70b9330d75f2cacd76  node-v18.20.8-darwin-arm64.tar.gz",
      `${LEGACY_NODE_SHA256}  ${LEGACY_NODE_FILE}`,
    ].join("\n");
    expect(findChecksumForFile(shasums, LEGACY_NODE_FILE)).toBe(LEGACY_NODE_SHA256);
    expect(findChecksumForFile(shasums, "node-vX.tar.gz")).toBeNull();
  });
});

// T5 — slice 2: montagem do pacote (duplo clique, dados fora, offline).
// Seam pública: conteúdo do lançador + lista de arquivos do pacote.
describe("T5 legacy — pacote abre com duplo clique, dados fora", () => {
  test("lançador .command usa o Node embarcado, mostra endereço+dados e limpa ao sair", () => {
    const sh = buildLauncherScript();
    expect(sh).toMatch(/#!\/bin\/bash/);
    expect(sh).toMatch(/runtime\/node\/bin\/node/);
    expect(sh).toMatch(/NODE_EMBARCADO/);
    expect(sh).not.toMatch(/EMBARCAADO/);
    expect(sh).toMatch(/server\/index\.js/);
    // Janela visível: endereço + pasta de dados fora do pacote.
    expect(sh).toMatch(/127\.0\.0\.1/);
    expect(sh).toMatch(/Library\/Application Support\/GestorTrafego/);
    // Abertura do navegador + encerramento limpo.
    expect(sh).toMatch(/open/);
    expect(sh).toMatch(/trap/);
    // Pacote incompleto falha com mensagem, nunca usa outro Node.
    expect(sh).toMatch(/Runtime Node 18 ausente/);
    // Sem instalar nada, sem admin.
    expect(sh).not.toMatch(/sudo/);
    expect(sh).not.toMatch(/npm install/);
  });

  test("preâmbulo do Node embarcado é fonte única (sem duplicar o caminho)", () => {
    const pre = legacyNodePreamble().join("\n");
    expect(pre).toMatch(/runtime\/node\/bin\/node/);
    expect(buildLauncherScript()).toContain(legacyNodePreamble()[1]);
  });

  test("layout esperado: servidor + migrações + cálculo + launcher, sem banco dentro", () => {
    const files = expectedLegacyLayout();
    for (const f of [
      "GestorTrafego-legacy.command",
      "smoke-legacy.js",
      "server/index.js",
      "server/migrations/001_init.sql",
      "server/migrations/002_domain.sql",
      "server/calc.js",
      "server/runtime/calc.js",
      "shared/calc.js",
      "package.json",
      "LEIA-ME-LEGACY.txt",
    ]) {
      expect(files).toContain(f);
    }
    // Banco e backups ficam fora do pacote (local padrão do sistema).
    expect(files.some((f) => f.endsWith("gestor.db"))).toBe(false);
    expect(files.some((f) => f.includes("backups/gestor-"))).toBe(false);
  });
});

// T5 — slice 3: script de fumaça (o criador roda e cola o resultado).
// Seam pública: relatório em texto com versão, saúde, caminhos, snapshot e cálculo.
describe("T5 legacy — fumaça imprime versão, saúde, caminhos, snapshot e cálculo", () => {
  test("formatSmokeReport traz as 5 seções em texto colável", () => {
    const txt = formatSmokeReport({
      nodeVersion: "v18.20.8",
      health: "ok",
      appVersion: "0.1.0",
      dataDir: "/Users/criador/Library/Application Support/GestorTrafego",
      dbPath: "/Users/criador/Library/Application Support/GestorTrafego/gestor.db",
      snapshot: "gestor-2026-09-22-120000.db (SQLite válido, 1 Criativo)",
      calc: "costOf+evaluateCreative OK",
    });
    expect(txt).toMatch(/versão/i);
    expect(txt).toMatch(/saúde/i);
    expect(txt).toMatch(/caminhos/i);
    expect(txt).toMatch(/snapshot/i);
    expect(txt).toMatch(/cálculo/i);
    expect(txt).toMatch(/v18\.20\.8/);
    expect(txt).toMatch(/gestor\.db/);
  });

  test("collectSmoke lê saúde, caminhos e cálculo do servidor real", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gestor-fumaca-"));
    const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
    try {
      const collected = await collectSmoke(`http://127.0.0.1:${server.port}`);
      expect(collected.health).toBe("ok");
      expect(collected.dbPath).toMatch(/gestor\.db/);
      expect(collected.dataDir).toBe(dataDir);
      expect(collected.calc).toMatch(/costOf/);
    } finally {
      server.stop();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  test("findHealthyBase acha o app aberto na faixa e null quando fechado", async () => {
    expect(await findHealthyBase(async (p) => p === 4175, 4173, 10)).toBe("http://127.0.0.1:4175");
    expect(await findHealthyBase(async () => false, 4173, 3)).toBeNull();
  });
});

// T5 — slice 4: primeira abertura + aceite + decisão registrada, glossário intacto.
// Seam pública: textos que o criador lê (LEIA-ME + checklist) + ADR + CONTEXT.md.
describe("T5 legacy — primeira abertura, aceite e ADR sem tocar o glossário", () => {
  test("LEIA-ME legacy: duplo clique, Gatekeeper, quarentena, dados fora, sem admin", () => {
    const txt = buildLeiaMeLegacy("0.1.0");
    expect(txt).toMatch(/duplo clique/i);
    expect(txt).toMatch(/sem instalar/i);
    expect(txt).toMatch(/botão direito[\s\S]*Abrir|clique[\s\S]*direito[\s\S]*Abrir/i);
    expect(txt).toMatch(/xattr/);
    expect(txt).toMatch(/sem admin|sem precisar de admin/i);
    expect(txt).toMatch(/Library\/Application Support\/GestorTrafego/);
    expect(txt).toMatch(/trocar.*pasta|troque.*pacote/i);
    expect(txt).toMatch(/offline/i);
  });

  test("checklist de aceite: abre → lança dia → fecha → reabre com dados", () => {
    const txt = buildChecklistLegacy();
    expect(txt).toMatch(/abre/i);
    expect(txt).toMatch(/lança.*dia|lançar/i);
    expect(txt).toMatch(/fecha/i);
    expect(txt).toMatch(/reabre.*dados/i);
  });

  test("ADR da variante publicada e glossário intacto", async () => {
    const { readFile } = await import("node:fs/promises");
    const adr = await readFile(join(process.cwd(), "docs", "adr", "0004-pacote-legacy-catalina.md"), "utf-8");
    expect(adr).toMatch(/Catalina/);
    expect(adr).toMatch(/Node 18/);
    expect(adr).toMatch(/duplo clique/i);
    const ctx = await readFile(join(process.cwd(), "CONTEXT.md"), "utf-8");
    for (const termo of ["Criativo", "Ativo", "Pausado", "Encerrado", "Sinal", "Escalando", "Lançamento", "Dia 1", "ROAS", "Imposto"]) {
      expect(ctx).toMatch(new RegExp(termo));
    }
    // Glossário é só produto: nada de runtime/sistema aqui.
    expect(ctx).not.toMatch(/Catalina/);
    expect(ctx).not.toMatch(/Node 18/);
    expect(ctx).not.toMatch(/darwin/);
  });
});
