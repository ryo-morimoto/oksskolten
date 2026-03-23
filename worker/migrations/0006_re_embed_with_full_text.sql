-- Reset embedded_at to re-embed all articles with full_text instead of title+excerpt only.
-- The next cron run will re-embed articles via IngestWorkflow.embedArticles().
UPDATE articles SET embedded_at = NULL WHERE embedded_at IS NOT NULL;
