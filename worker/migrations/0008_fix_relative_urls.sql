-- Fix relative URLs for Zach Tellman (feed_id=116, ideolalia.com).
-- RSS feed returns paths like /essays/... without base URL.
-- resolveUrl was added in 725924f but existing rows were not repaired.
UPDATE articles
SET url = 'https://ideolalia.com' || url
WHERE feed_id = 116 AND url LIKE '/%';
