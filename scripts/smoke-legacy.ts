// scripts/smoke-legacy.ts — T5 Fumaça do pacote legacy.
//
// O criador roda e cola o resultado no suporte (sem acesso remoto):
// imprime versão, saúde, caminhos, snapshot e cálculo.
// - Com o app aberto (padrão): sonda a instância saudável na faixa do boot
//   (4173→4182) ou a `--url` dada — só leitura, sem escrever nos dados.
//   Os caminhos impressos são os REAIS (`~/Library/.../gestor.db`).
// - Com o app fechado: roda um ciclo isolado temporário
//   (abre → lança dia → fecha → reabre com dados, em dados temporários)
//   e marca o relatório como ISOLADO — prova que o pacote funciona sem
//   tocar nos dados reais.
//
// Roda nos dois runtimes (`bun run smoke:legacy` em dev,
// `node smoke-legacy.js` no pacote legacy): só `node:*` + fetch.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectSmoke, findHealthyBase, formatSmokeReport } from "../src/server/runtime/smoke.ts";
import { costOf } from "../src/shared/calc.ts";

function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

async function getJson(base: string, path: string): Promise<any> {
  return (await (await fetch(`${base}${path}`)).json()) as any;
}

async function snapshotOf(base: string): Promise<string> {
  try {
    const backups = (await getJson(base, "/api/backups")) as { data?: { file: string }[] };
    const exp = (await getJson(base, "/api/export")) as {
      data?: { creatives?: unknown[]; entries?: unknown[] };
    };
    const n = backups.data?.length ?? 0;
    const nc = exp.data?.creatives?.length ?? 0;
    const ne = exp.data?.entries?.length ?? 0;
    return `backups=${n} export(criativos=${nc}, lançamentos=${ne})`;
  } catch (err) {
    return `indisponível (${err instanceof Error ? err.message : String(err)})`;
  }
}

function calcResumo(calcJs: string): string {
  return calcJs.includes("costOf") && calcJs.includes("evaluateCreative")
    ? "costOf+evaluateCreative OK"
    : "cálculo divergente";
}

async function probeBase(base: string, origem: string): Promise<void> {
  // Sonda o app aberto: só leitura, sem escrever nos dados do criador.
  const c = await collectSmoke(base);
  const snapshot = await snapshotOf(base);
  console.log(
    formatSmokeReport({
      nodeVersion: process.version,
      health: `${c.health} (${origem})`,
      appVersion: c.appVersion,
      dataDir: c.dataDir,
      dbPath: c.dbPath,
      snapshot,
      calc: calcResumo(c.calc),
    }),
  );
}

const flagUrl = arg("--url")?.replace(/\/$/, "") ?? null;
if (flagUrl) {
  await probeBase(flagUrl, `sonda ${flagUrl}`);
  process.exit(0);
}

// Sem --url: prefere o app aberto (caminhos reais); fechado → ciclo isolado.
const aberta = await findHealthyBase(async (port) => {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`);
    if (!r.ok) return false;
    return ((await r.json()) as { status?: string }).status === "ok";
  } catch {
    return false;
  }
});
if (aberta) {
  await probeBase(aberta, `app aberto em ${aberta}`);
  process.exit(0);
}

// Ciclo isolado temporário: abre → lança dia → fecha → reabre com dados.
const { startServer } = await import("../src/server/app.ts");
const dataDir = await mkdtemp(join(tmpdir(), "gestor-fumaca-"));
const server = await startServer({ host: "127.0.0.1", port: 0, dataDir });
const base = `http://127.0.0.1:${server.port}`;
try {
  // Lança dia: Criativo + Lançamento.
  const res = await fetch(`${base}/api/creatives`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Fumaça 01", start_date: "2026-09-01" }),
  });
  const createdJson = (await res.json()) as { data?: { id: number } };
  const id = createdJson.data?.id;
  if (id == null) throw new Error("criar Criativo falhou na fumaça");
  const put = await fetch(`${base}/api/creatives/${id}/entries/2026-09-01`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ investment_cents: 500, sales: 1, revenue_cents: 2000, clicks_meta: 100, clicks_shopee: 200 }),
  });
  if (put.status !== 200) throw new Error(`lançar dia falhou na fumaça (HTTP ${put.status})`);

  const c = await collectSmoke(base);
  const snapshot = await snapshotOf(base);

  // Fecha → reabre com dados (mesmo dataDir, novo boot).
  const portBefore = server.port;
  server.stop();
  const server2 = await startServer({ host: "127.0.0.1", port: 0, dataDir });
  try {
    const list = (await getJson(`http://127.0.0.1:${server2.port}`, "/api/creatives")) as {
      data?: { name: string }[];
    };
    const reabriu = (list.data ?? []).some((x) => x.name === "Fumaça 01") ? "reabriu com dados OK" : "REABRIU SEM DADOS";
    const custoLocal = costOf({ investment_cents: 500, tax_rate: 0.1386 });
    console.log(
      formatSmokeReport({
        nodeVersion: process.version,
        health: `${c.health} (ciclo ISOLADO — app fechado, dados temporários)`,
        appVersion: c.appVersion,
        dataDir: c.dataDir,
        dbPath: c.dbPath,
        snapshot: `${snapshot} · ciclo isolado (porta ${portBefore}) · ${reabriu}`,
        calc: `${calcResumo(c.calc)} (custo local 500→${custoLocal.toFixed(2)})`,
      }),
    );
  } finally {
    server2.stop();
  }
} finally {
  await rm(dataDir, { recursive: true, force: true }).catch(() => {});
}
