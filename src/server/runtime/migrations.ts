// Seam de migrações (T1 — porte Node 18).
//
// A leitura dos SQL de boot passa por esta função. Hoje o adapter é o
// import estático (o `bun build --compile` embute o texto no executável,
// então o exe funciona sem arquivos ao lado). A variante Node (T2) troca o
// corpo por leitura de arquivo em tempo de boot, preservando a semântica
// síncrona — o chamador (`db.ts`) não muda.
import initSql from "../migrations/001_init.sql" with { type: "text" };
import domainSql from "../migrations/002_domain.sql" with { type: "text" };

export const CURRENT_SCHEMA_VERSION = 2;

export function loadMigrationSql(): { initSql: string; domainSql: string } {
  return { initSql, domainSql };
}
