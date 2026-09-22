import type { Database } from "bun:sqlite";
import { ensureDataDir, openDatabase } from "./db.ts";
import { INDEX_HTML, APP_VERSION, CALC_JS, assets } from "./assets.ts";
import { createCreative, createCreativesBulk, getCreative, getCreativeDetail, listCreatives, updateCreative } from "./creatives.ts";
import { deleteOneEntry, getDay, pendingWarning, saveCreativeBulk, saveDayBulk, saveOneEntry } from "./entries.ts";
import { getDashboard, parseDashboardQuery } from "./dashboard.ts";
import { getSettings, updateSettings, countAffectedByCutoff } from "./settings.ts";
import { backupNow, ensureDailyBackup, getExportData, listBackupFiles, backupFileSize } from "./backup.ts";
import { dbPathFor } from "./paths.ts";
import { isValidDate } from "../shared/calc.ts";

export interface StartServerOptions {
  host?: string;
  port?: number;
  dataDir: string;
}

export interface StartedServer {
  hostname: string;
  port: number;
  url: string;
  dataDir: string;
  db: Database;
  stop: () => void;
}

const LOOPBACK = "127.0.0.1";

/** Sobe o servidor somente em loopback. Porta 0 = efêmera (testes). */
export async function startServer(opts: StartServerOptions): Promise<StartedServer> {
  const host = opts.host ?? LOOPBACK;
  if (host !== LOOPBACK) {
    throw new Error(`[gestor] host ${host} recusado: só ${LOOPBACK} (nunca expor na rede)`);
  }
  await ensureDataDir(opts.dataDir);
  const db = openDatabase(opts.dataDir);
  // Backup diário (30 últimos). Nunca derruba o boot se falhar.
  try {
    await ensureDailyBackup(db, opts.dataDir);
  } catch (err) {
    console.warn(`[gestor] backup diário falhou: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Módulo único de cálculo: fonte em src/shared/calc.ts, transpilado na hora
  // para o navegador (ao-vivo). Cacheado no boot; em `bun build --compile`
  // não há fonte ao lado do exe — o fallback é o CALC_JS embutido (T6 cobre).
  let calcJs: string | null = null;
  async function getCalcJs(): Promise<string> {
    if (calcJs != null) return calcJs;
    try {
      const src = await Bun.file(new URL("../shared/calc.ts", import.meta.url)).text();
      calcJs = new Bun.Transpiler({ loader: "ts" }).transformSync(src, "ts");
      return calcJs;
    } catch {
      // Executável sem fonte ao lado: usa o bundle embutido pelo embed.
      if (CALC_JS) {
        calcJs = CALC_JS;
        return calcJs;
      }
      throw new Error("calc_indisponivel");
    }
  }
  try {
    await getCalcJs();
  } catch {
    // Se nem o ao-vivo nem o embutido funcionarem, a rota responde 500.
    calcJs = CALC_JS || null;
  }

  const server = Bun.serve({
    hostname: host,
    port: opts.port ?? 4173,
    async fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health" && req.method === "GET") {
        return Response.json({ status: "ok", version: APP_VERSION });
      }
      // Módulo único de cálculo servido ao navegador para o ao-vivo.
      if (url.pathname === "/shared/calc.js" && req.method === "GET") {
        try {
          const js = await getCalcJs();
          return new Response(js, {
            headers: { "content-type": "text/javascript; charset=utf-8" },
          });
        } catch {
          return Response.json({ error: "calc_indisponivel" }, { status: 500 });
        }
      }
      if (url.pathname === "/api/creatives" && req.method === "GET") {
        const data = listCreatives(db, {
          q: url.searchParams.get("q") ?? "",
          status: url.searchParams.get("status") ?? "all",
          product: url.searchParams.get("product") ?? "",
          sort: url.searchParams.get("sort") ?? url.searchParams.get("orderBy") ?? "recent",
          order: url.searchParams.get("order") ?? url.searchParams.get("dir") ?? "",
        });
        return Response.json({ data, warnings: [] });
      }
      if (url.pathname === "/api/dashboard" && req.method === "GET") {
        const parsed = parseDashboardQuery(url.searchParams);
        if (!parsed.ok) {
          return Response.json({ error: parsed.error, warnings: [] }, { status: 400 });
        }
        const result = getDashboard(db, parsed.filter);
        return Response.json({ data: result, warnings: result.warnings });
      }
      if (url.pathname === "/api/settings" && req.method === "GET") {
        return Response.json({ data: getSettings(db), warnings: [] });
      }
      if (url.pathname === "/api/settings/affected" && req.method === "GET") {
        const from = url.searchParams.get("from") ?? "";
        if (!isValidDate(from)) {
          return Response.json({ error: "data_invalida", warnings: [] }, { status: 400 });
        }
        return Response.json({ data: { from, count: countAffectedByCutoff(db, from) }, warnings: [] });
      }
      if (url.pathname === "/api/settings" && (req.method === "PUT" || req.method === "PATCH")) {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = updateSettings(db, (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (url.pathname === "/api/info" && req.method === "GET") {
        return Response.json({
          data: { dbPath: dbPathFor(opts.dataDir), dataDir: opts.dataDir, version: APP_VERSION },
          warnings: [],
        });
      }
      if ((url.pathname === "/api/backup" || url.pathname === "/api/backups") && req.method === "POST") {
        try {
          const res = await backupNow(db, opts.dataDir);
          return Response.json({ data: { file: res.file, path: res.path, kept: res.kept }, warnings: [] }, { status: 201 });
        } catch (err) {
          return Response.json(
            { error: "backup_falhou", warnings: [], detail: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      }
      if (url.pathname === "/api/backups" && req.method === "GET") {
        const files = await listBackupFiles(opts.dataDir);
        const withSize = await Promise.all(
          files.map(async (file) => ({ file, size: await backupFileSize(opts.dataDir, file) })),
        );
        return Response.json({ data: withSize, warnings: [] });
      }
      if (url.pathname === "/api/export" && req.method === "GET") {
        const data = getExportData(db);
        return Response.json({ data, warnings: [] });
      }
      if (url.pathname === "/api/creatives/bulk" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = createCreativesBulk(db, (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (url.pathname === "/api/creatives" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = createCreative(db, (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      const detail = url.pathname.match(/^\/api\/creatives\/(\d+)$/);
      if (detail && req.method === "GET") {
        const item = getCreative(db, Number(detail[1]));
        if (!item) return Response.json({ error: "not_found" }, { status: 404 });
        return Response.json({ data: item, warnings: [] });
      }
      if (detail && (req.method === "PATCH" || req.method === "PUT")) {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = updateCreative(db, Number(detail[1]), (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      const detailEntries = url.pathname.match(/^\/api\/creatives\/(\d+)\/entries$/);
      if (detailEntries && req.method === "GET") {
        const month = url.searchParams.get("month") ?? undefined;
        const result = getCreativeDetail(db, Number(detailEntries[1]), month ?? undefined);
        if (!result.ok) {
          const code = result.error === "not_found" ? 404 : 400;
          return Response.json({ error: result.error, warnings: [] }, { status: code });
        }
        const pend = result.detail.entries.filter((e) => e.is_pending).length;
        const w = pend > 0 ? pendingWarning(pend) : null;
        return Response.json({ data: result.detail, warnings: w ? [w] : [] });
      }
      const entryUpsert = url.pathname.match(/^\/api\/creatives\/(\d+)\/entries\/(\d{4}-\d{2}-\d{2})$/);
      if (entryUpsert && req.method === "PUT") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const result = saveOneEntry(db, Number(entryUpsert[1]), entryUpsert[2], (body ?? {}) as Record<string, unknown>);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (entryUpsert && req.method === "DELETE") {
        const result = deleteOneEntry(db, Number(entryUpsert[1]), entryUpsert[2]);
        return Response.json(result.body, { status: result.statusCode });
      }
      const creativeBulk = url.pathname.match(/^\/api\/creatives\/(\d+)\/entries\/bulk$/);
      if (creativeBulk && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const rec = (body ?? {}) as Record<string, unknown>;
        const result = saveCreativeBulk(db, Number(creativeBulk[1]), rec.entries, rec.deletions ?? []);
        return Response.json(result.body, { status: result.statusCode });
      }
      if (url.pathname === "/api/entries" && req.method === "GET") {
        const date = url.searchParams.get("date") ?? "";
        if (!isValidDate(date)) {
          return Response.json({ error: "data_invalida", warnings: [] }, { status: 400 });
        }
        const data = getDay(db, date);
        return Response.json({ date, data, warnings: [] });
      }
      if (url.pathname === "/api/entries/bulk" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return Response.json({ error: "json_invalido", warnings: [] }, { status: 400 });
        }
        const rec = (body ?? {}) as Record<string, unknown>;
        const result = saveDayBulk(db, typeof rec.date === "string" ? rec.date : "", rec.entries);
        return Response.json(result.body, { status: result.statusCode });
      }
      if ((url.pathname === "/" || url.pathname === "/index.html") && req.method === "GET") {
        return new Response(INDEX_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      // T6 offline: qualquer arquivo em src/web/ embutido no exe
      // (fontes .woff2 locais, css, js, svg…). 100% offline, sem CDN.
      if (req.method === "GET") {
        const key = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
        const asset = assets[key];
        if (asset) {
          if (asset.text !== undefined) {
            return new Response(asset.text, {
              headers: { "content-type": asset.contentType },
            });
          }
          if (asset.binary !== undefined) {
            const bytes = asset.binary as unknown as Uint8Array;
            return new Response(bytes, {
              headers: { "content-type": asset.contentType },
            });
          }
        }
      }
      return Response.json({ error: "not_found" }, { status: 404 });
    },
  });

  return {
    hostname: server.hostname ?? host,
    port: server.port ?? (opts.port ?? 4173),
    url: `http://${server.hostname ?? host}:${server.port ?? opts.port ?? 4173}`,
    dataDir: opts.dataDir,
    db,
    stop() {
      server.stop(true);
      db.close();
    },
  };
}

/** Sonda se já existe instância saudável na porta. */
export async function probeHealth(port: number, timeoutMs = 800): Promise<boolean> {
  try {
    const res = await fetch(`http://${LOOPBACK}:${port}/api/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === "ok";
  } catch {
    return false;
  }
}
