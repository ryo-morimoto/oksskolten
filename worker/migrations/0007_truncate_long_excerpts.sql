-- Truncate oversized excerpts that were stored before the plainExcerpt() guard was added.
-- Only targets articles where full_text is NULL (RSS-only excerpt, never processed by Defuddle).
UPDATE articles
SET excerpt = SUBSTR(excerpt, 1, 500)
WHERE LENGTH(excerpt) > 500;
