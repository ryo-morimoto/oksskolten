-- Backfill published_at for articles where RSS omitted the date.
-- Uses fetched_at as a reasonable approximation.
-- Prevents NULL from leaking into downstream consumers that don't COALESCE.
UPDATE articles
SET published_at = fetched_at
WHERE published_at IS NULL;
