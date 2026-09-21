-- 001_init.sql — Fase 0 (esqueleto).
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
