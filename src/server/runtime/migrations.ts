// Seam de migrações (T1 — porte Node 18; T2 — leitura via arquivo).
//
// A leitura dos SQL de boot passa por esta função, sempre síncrona.
// - Padrão (Bun dev): lê `src/server/migrations/*.sql` do disco.
// - Variante Node (T2): mesma leitura de arquivo em tempo de boot
//   (o pacote legacy embarca os `.sql` ao lado do servidor).
// - Executável Bun (`--compile`, sem arquivos ao lado): cai para o
//   embutido abaixo (mesmo conteúdo dos `.sql`, sem drift — ver teste T2).
// O chamador (`db.ts`) não muda em nenhum runtime.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const CURRENT_SCHEMA_VERSION = 2;

// Embutido para o exe sem arquivos ao lado. Fonte da verdade continua
// sendo `src/server/migrations/*.sql` — manter sincronizado (o teste T2
// quebra se divergir, mesmo ignorando quebra de linha).
export const EMBEDDED_INIT_SQL = `-- 001_init.sql — Fase 0 (esqueleto).
-- Cria o mínimo para provar "primeira abertura cria estrutura + schema_migrations".
-- Tabelas de domínio (creatives, daily_entries) chegam na Fase 1 (T2) via 002.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('tax_rate', '0.1386');
`;

export const EMBEDDED_DOMAIN_SQL = `-- 002_domain.sql — T2 (Fase 1): domínio Criativo + Lançamento.
-- Spec #6: status em (ativo, escalando, pausado, encerrado); nome único
-- case-insensitive entre não-Encerrados; revenue_cents NULL = pendente;
-- tax_rate por dia (dias antigos intactos); journal_mode = DELETE (Drive).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS creatives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  product TEXT NOT NULL DEFAULT '',
  format TEXT NOT NULL DEFAULT 'video' CHECK (format IN ('video', 'image', 'carousel')),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'escalando', 'pausado', 'encerrado')),
  start_date TEXT NOT NULL,
  url TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_creatives_name ON creatives (lower(name)) WHERE status != 'encerrado';

CREATE TABLE IF NOT EXISTS daily_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  creative_id INTEGER NOT NULL REFERENCES creatives(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  investment_cents INTEGER NOT NULL DEFAULT 0 CHECK (investment_cents >= 0),
  sales INTEGER NOT NULL DEFAULT 0 CHECK (sales >= 0),
  revenue_cents INTEGER CHECK (revenue_cents IS NULL OR revenue_cents >= 0),
  clicks_meta INTEGER NOT NULL DEFAULT 0 CHECK (clicks_meta >= 0),
  clicks_shopee INTEGER NOT NULL DEFAULT 0 CHECK (clicks_shopee >= 0),
  tax_rate REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  UNIQUE (creative_id, date)
);
CREATE INDEX IF NOT EXISTS ix_entries_date ON daily_entries (date);
CREATE INDEX IF NOT EXISTS ix_entries_creative ON daily_entries (creative_id);
`;

function readSqlFile(fileName: string): string | null {
  const candidates: string[] = [];
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // Dev (src/server/runtime → src/server/migrations).
    candidates.push(join(here, "..", "migrations", fileName));
    // Pacote legacy: .sql ao lado do servidor compilado.
    candidates.push(join(here, "migrations", fileName));
    candidates.push(join(here, "..", "..", "migrations", fileName));
  } catch {
    // import.meta indisponível? Tenta via cwd abaixo.
  }
  candidates.push(join(process.cwd(), "src", "server", "migrations", fileName));
  candidates.push(join(process.cwd(), "dist", "migrations", fileName));
  candidates.push(join(process.cwd(), "migrations", fileName));
  for (const p of candidates) {
    try {
      return readFileSync(p, "utf-8");
    } catch {
      // tenta o próximo
    }
  }
  return null;
}

export function loadMigrationSql(): { initSql: string; domainSql: string } {
  const initFromFile = readSqlFile("001_init.sql");
  const domainFromFile = readSqlFile("002_domain.sql");
  if (initFromFile != null && domainFromFile != null) return { initSql: initFromFile, domainSql: domainFromFile };
  return { initSql: EMBEDDED_INIT_SQL, domainSql: EMBEDDED_DOMAIN_SQL };
}
