-- 002_domain.sql — T2 (Fase 1): domínio Criativo + Lançamento.
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
