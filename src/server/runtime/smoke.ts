// Fumaça do pacote legacy (T5 — o criador roda e cola o resultado).
//
// Seam pública: relatório em texto com as 5 seções que o suporte precisa
// sem acesso remoto — versão, saúde, caminhos, snapshot e cálculo.
// `formatSmokeReport` é puro (texto colável); `collectSmoke` lê as mesmas
// 5 seções de um servidor real via HTTP (contrato externo, sem internos).
export interface SmokeFields {
  nodeVersion: string;
  health: string;
  appVersion: string;
  dataDir: string;
  dbPath: string;
  snapshot: string;
  calc: string;
}

/** Monta o texto que o criador cola no suporte (5 seções, sem segredo). */
export function formatSmokeReport(f: SmokeFields): string {
  return [
    `Gestor de Tráfego Pago (legacy) — fumaça`,
    ``,
    `Versão: runtime ${f.nodeVersion} · app ${f.appVersion}`,
    `Saúde: ${f.health}`,
    `Caminhos: dados em ${f.dataDir} · banco em ${f.dbPath}`,
    `Snapshot: ${f.snapshot}`,
    `Cálculo: ${f.calc}`,
  ].join("\n");
}

export interface CollectedSmoke {
  health: string;
  appVersion: string;
  dataDir: string;
  dbPath: string;
  calc: string;
}

async function getJson(base: string, path: string): Promise<any> {
  return (await (await fetch(`${base}${path}`)).json()) as any;
}

/** Varre a faixa de portas do boot e devolve a base do app aberto (ou null).
 *  Injetável para teste (`probe` recebe a porta e diz se há saúde). */
export async function findHealthyBase(
  probe: (port: number) => Promise<boolean>,
  firstPort = 4173,
  maxTries = 10,
): Promise<string | null> {
  for (let port = firstPort; port < firstPort + maxTries; port += 1) {
    if (await probe(port)) return `http://127.0.0.1:${port}`;
  }
  return null;
}

/** Lê saúde, caminhos e cálculo de um servidor real (base `http://127.0.0.1:PORTA`). */
export async function collectSmoke(baseUrl: string): Promise<CollectedSmoke> {
  const base = baseUrl.replace(/\/$/, "");
  const healthJson = (await getJson(base, "/api/health")) as {
    status?: string;
    version?: string;
  };
  const infoJson = (await getJson(base, "/api/info")) as {
    data?: { dataDir?: string; dbPath?: string; version?: string };
  };
  const calcJs = await (await fetch(`${base}/shared/calc.js`)).text();
  return {
    health: healthJson.status ?? "desconhecida",
    appVersion: healthJson.version ?? infoJson.data?.version ?? "?",
    dataDir: infoJson.data?.dataDir ?? "?",
    dbPath: infoJson.data?.dbPath ?? "?",
    calc: calcJs,
  };
}
