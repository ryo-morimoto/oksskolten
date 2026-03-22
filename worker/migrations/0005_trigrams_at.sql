-- Track which articles have had trigrams built (idempotency guard)
ALTER TABLE articles ADD COLUMN trigrams_at TEXT;
