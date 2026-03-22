-- P1: FTS5 full-text search + trigram dictionary for typo correction
-- Depends on: 0001_initial.sql (articles table with title_tokens, full_text_tokens)

-- FTS5 virtual table (content-sync with articles table)
CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title_tokens,
  full_text_tokens,
  content=articles,
  content_rowid=rowid,
  tokenize='unicode61'
);

-- Sync triggers: keep articles_fts in sync with articles table.
-- Use COALESCE(col, '') to normalize NULL → empty string.
-- NULL and '' both produce zero tokens from the tokenizer, so FTS5 behavior is identical.
-- This eliminates WHEN-guard complexity and guarantees matching insert/delete pairs.

CREATE TRIGGER IF NOT EXISTS articles_fts_insert AFTER INSERT ON articles
BEGIN
  INSERT INTO articles_fts(rowid, title_tokens, full_text_tokens)
    VALUES (NEW.rowid, COALESCE(NEW.title_tokens, ''), COALESCE(NEW.full_text_tokens, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_update AFTER UPDATE OF title_tokens, full_text_tokens ON articles
BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title_tokens, full_text_tokens)
    VALUES ('delete', OLD.rowid, COALESCE(OLD.title_tokens, ''), COALESCE(OLD.full_text_tokens, ''));
  INSERT INTO articles_fts(rowid, title_tokens, full_text_tokens)
    VALUES (NEW.rowid, COALESCE(NEW.title_tokens, ''), COALESCE(NEW.full_text_tokens, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_delete AFTER DELETE ON articles
BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title_tokens, full_text_tokens)
    VALUES ('delete', OLD.rowid, COALESCE(OLD.title_tokens, ''), COALESCE(OLD.full_text_tokens, ''));
END;

-- Remove from FTS when soft-deleted (purged_at set)
CREATE TRIGGER IF NOT EXISTS articles_fts_purge AFTER UPDATE OF purged_at ON articles
  WHEN NEW.purged_at IS NOT NULL AND OLD.purged_at IS NULL
BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title_tokens, full_text_tokens)
    VALUES ('delete', OLD.rowid, COALESCE(OLD.title_tokens, ''), COALESCE(OLD.full_text_tokens, ''));
END;

-- Trigram dictionary: kuromoji nouns accumulated per article
CREATE TABLE IF NOT EXISTS term_dictionary (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  term      TEXT NOT NULL UNIQUE,
  frequency INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS term_trigrams (
  trigram TEXT    NOT NULL,
  term_id INTEGER NOT NULL REFERENCES term_dictionary(id) ON DELETE CASCADE,
  PRIMARY KEY (trigram, term_id)
);

CREATE INDEX IF NOT EXISTS idx_trigrams ON term_trigrams(trigram);

-- Backfill: populate FTS from any articles that already have tokens
INSERT INTO articles_fts(rowid, title_tokens, full_text_tokens)
  SELECT rowid, title_tokens, full_text_tokens
  FROM articles
  WHERE (title_tokens IS NOT NULL OR full_text_tokens IS NOT NULL)
    AND purged_at IS NULL;
