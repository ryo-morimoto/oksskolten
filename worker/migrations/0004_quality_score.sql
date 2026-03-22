-- P4: Structural quality score for article triage
ALTER TABLE articles ADD COLUMN quality_score REAL;
CREATE INDEX IF NOT EXISTS idx_articles_quality_score ON articles(quality_score DESC);
