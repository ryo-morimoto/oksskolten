import { Hono } from "hono";
import type { AppContext } from "../index";

export const statsRoutes = new Hono<AppContext>();

statsRoutes.get("/stats", async (c) => {
  const [articleStats, feedCount, categoryCount] = await c.env.DB.batch([
    c.env.DB.prepare(`
      SELECT
        COUNT(*) AS total_articles,
        SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END) AS unread_articles,
        SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) AS read_articles,
        SUM(CASE WHEN bookmarked_at IS NOT NULL THEN 1 ELSE 0 END) AS bookmarked_articles,
        SUM(CASE WHEN liked_at IS NOT NULL THEN 1 ELSE 0 END) AS liked_articles
      FROM active_articles
    `),
    c.env.DB.prepare("SELECT COUNT(*) AS total_feeds FROM feeds"),
    c.env.DB.prepare("SELECT COUNT(*) AS total_categories FROM categories"),
  ]);

  const a = (articleStats.results[0] ?? {}) as {
    total_articles: number;
    unread_articles: number;
    read_articles: number;
    bookmarked_articles: number;
    liked_articles: number;
  };
  const f = (feedCount.results[0] ?? {}) as { total_feeds: number };
  const cat = (categoryCount.results[0] ?? {}) as { total_categories: number };

  return c.json({
    total_articles: a.total_articles ?? 0,
    unread_articles: a.unread_articles ?? 0,
    read_articles: a.read_articles ?? 0,
    bookmarked_articles: a.bookmarked_articles ?? 0,
    liked_articles: a.liked_articles ?? 0,
    total_feeds: f.total_feeds ?? 0,
    total_categories: cat.total_categories ?? 0,
  });
});
