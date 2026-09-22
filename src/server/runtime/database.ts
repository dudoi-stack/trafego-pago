// Seam de persistência (T1 — porte Node 18).
//
// O domínio (creatives, entries, dashboard, settings, backup, db) programa
// contra esta interface mínima, nunca contra `bun:sqlite` direto.
// Adapter atual: Bun (bun:sqlite). A variante Node (T2) troca só o adapter
// aqui dentro — nenhuma regra de domínio é reescrita.
//
// Superfície usada pelo domínio (verificada contra todos os call sites):
// - exec(sql) para pragmas, DDL e controle de transação;
// - query(sql).all(...params) para leituras (retorna linhas);
// - query(sql).run(...params) para escritas (retorna { changes });
// - close() no encerramento.
import { Database as BunDatabase } from "bun:sqlite";

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

/** Adapter Bun: abre o SQLite via bun:sqlite. Variante Node troca esta função. */
export function openDatabaseFile(path: string, opts?: OpenOptions): Database {
  return new BunDatabase(path, opts ?? { create: true }) as unknown as Database;
}
