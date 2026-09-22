// Seam de persistência (T1 — porte Node 18; T2 — variante Node).
//
// O domínio (creatives, entries, dashboard, settings, backup, db) programa
// contra esta interface mínima, nunca contra o driver direto.
// - Padrão (Bun): `bun:sqlite` via `query().all/run`, `exec`, `close`.
// - Variante Node (T2): `better-sqlite3@11.10.0` (pinado, prebuild darwin-x64
//   para o Mac antigo) via `prepare().all/run`, `exec`, `close` — mesma
//   superfície, mesmo arquivo, sem migração. Em dev (Node 20+ sem o nativo
//   instalado) cai para o `node:sqlite` embutido, mesmo formato em disco,
//   mesmo mapeamento — a verificação aqui vale para os dois.
// Nenhuma regra de domínio é reescrita: só este arquivo troca o adapter.
//
// Superfície usada pelo domínio (verificada contra todos os call sites):
// - exec(sql) para pragmas, DDL e controle de transação;
// - query(sql).all(...params) para leituras (retorna linhas);
// - query(sql).run(...params) para escritas (retorna { changes });
// - close() no encerramento.
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { isBunRuntime } from "./env.ts";

export interface DbStatement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(...params: any[]): any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...params: any[]): any;
}

export interface Database {
  exec(sql: string): void;
  query(sql: string): DbStatement;
  close(): void;
}

export interface OpenOptions {
  create?: boolean;
  readonly?: boolean;
}

/** Versão pinada da variante legacy (Node 18 + darwin-x64 Catalina). */
export const LEGACY_SQLITE_DRIVER = "better-sqlite3@11.10.0";

/** Qual driver o caminho Node usaria aqui (sem abrir banco). */
export function getNodeDriverKind(): "better-sqlite3" | "node:sqlite" | "indisponivel" {
  const req = createRequire(import.meta.url);
  try {
    req("better-sqlite3");
    return "better-sqlite3";
  } catch {
    // Nativo ausente (dev sem prebuild): tenta o embutido.
  }
  try {
    req("node:sqlite");
    return "node:sqlite";
  } catch {
    return "indisponivel";
  }
}

function loadBunDatabaseCtor(): new (path: string, opts?: Record<string, unknown>) => {
  exec(sql: string): void;
  query(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
  close(): void;
} {
  const req = createRequire(import.meta.url);
  const mod = req("bun:sqlite") as {
    Database: new (path: string, opts?: Record<string, unknown>) => {
      exec(sql: string): void;
      query(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
      close(): void;
    };
  };
  return mod.Database;
}

interface QueryStyleRaw {
  exec(sql: string): void;
  query(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
  close(): void;
}

interface PrepareStyleRaw {
  exec(sql: string): void;
  prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
  close(): void;
}

function wrapQueryStyle(raw: QueryStyleRaw): Database {
  return {
    exec(sql: string): void {
      raw.exec(sql);
    },
    query(sql: string): DbStatement {
      const stmt = raw.query(sql);
      return {
        all(...params: unknown[]): unknown[] {
          return stmt.all(...params) as unknown[];
        },
        run(...params: unknown[]): unknown {
          return stmt.run(...params);
        },
      };
    },
    close(): void {
      raw.close();
    },
  };
}

function wrapPrepareStyle(raw: PrepareStyleRaw): Database {
  return {
    exec(sql: string): void {
      raw.exec(sql);
    },
    query(sql: string): DbStatement {
      const stmt = raw.prepare(sql);
      return {
        all(...params: unknown[]): unknown[] {
          return stmt.all(...params) as unknown[];
        },
        run(...params: unknown[]): unknown {
          return stmt.run(...params);
        },
      };
    },
    close(): void {
      raw.close();
    },
  };
}

function openWithBun(path: string, opts?: OpenOptions): Database {
  const Ctor = loadBunDatabaseCtor();
  const raw = new Ctor(path, (opts ?? { create: true }) as Record<string, unknown>);
  return wrapQueryStyle(raw);
}

function openWithBetterSqlite3(path: string, opts?: OpenOptions): Database {
  const req = createRequire(import.meta.url);
  // Pinado em versão exata (ver LEGACY_SQLITE_DRIVER). Prebuild darwin-x64
  // no Mac antigo: sem compilar nada no alvo.
  const Ctor = req("better-sqlite3") as new (
    path: string,
    options?: { readonly?: boolean; fileMustExist?: boolean },
  ) => {
    exec(sql: string): void;
    prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
    close(): void;
  };
  const raw = new Ctor(path, {
    readonly: opts?.readonly === true,
    // create:false = o arquivo precisa existir (igual ao bun:sqlite).
    fileMustExist: opts?.create === false,
  });
  return wrapPrepareStyle(raw);
}

function openWithNodeSqlite(path: string, opts?: OpenOptions): Database {
  const req = createRequire(import.meta.url);
  const mod = req("node:sqlite") as {
    DatabaseSync: new (
      path: string,
      options?: { readOnly?: boolean; open?: boolean },
    ) => {
      exec(sql: string): void;
      prepare(sql: string): { all(...p: unknown[]): unknown[]; run(...p: unknown[]): unknown };
      close(): void;
    };
  };
  if (opts?.create === false && path !== ":memory:" && !existsSync(path)) {
    throw new Error(`unable to open database file: ${path}`);
  }
  const raw = new mod.DatabaseSync(path, {
    readOnly: opts?.readonly === true,
  });
  return wrapPrepareStyle(raw);
}

/** Caminho Node forçado (testes T2 + variante legacy): better-sqlite3
 *  quando o nativo está instalado, senão o node:sqlite embutido.
 *  Mesmo mapeamento, mesmo arquivo, sem migração. */
export function openNodeDatabaseFile(path: string, opts?: OpenOptions): Database {
  try {
    return openWithBetterSqlite3(path, opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Nativo ausente neste ambiente (dev sem prebuild) → embutido.
    // Erro de "arquivo não existe" (fileMustExist) não cai no fallback:
    // é erro real de abertura, igual nos dois drivers.
    if (/CANTOPEN|unable to open database file|fileMustExist|does not exist|no such file/i.test(msg)) {
      // Se o arquivo realmente não existe e create:false, propaga.
      if (opts?.create === false && path !== ":memory:" && !existsSync(path)) throw err;
    }
    try {
      return openWithNodeSqlite(path, opts);
    } catch {
      // Sem fallback possível: devolve o erro original (nativo).
      throw err;
    }
  }
}

/** Adapter padrão: Bun quando disponível, senão o caminho Node (legacy).
 *  O domínio chama só esta função — trocar o runtime nunca reescreve regra. */
export function openDatabaseFile(path: string, opts?: OpenOptions): Database {
  if (isBunRuntime()) {
    try {
      return openWithBun(path, opts);
    } catch {
      // Bun sem bun:sqlite (exe mínimo)? Cai no Node — mesmo arquivo.
    }
  }
  return openNodeDatabaseFile(path, opts);
}
