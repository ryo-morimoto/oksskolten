import { Hono } from "hono";
import type { AppContext } from "../index";

export const articleRoutes = new Hono<AppContext>();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

articleRoutes.get("/articles", async (c) => {
  const feedId = c.req.query("feed_id");
  const categoryId = c.req.query("category_id");
  const unread = c.req.query("unread") === "1";
  const bookmarked = c.req.query("bookmarked") === "1";
  const liked = c.req.query("liked") === "1";
  const sort = c.req.query("sort") === "score" ? "score" : "published_at";
  const limit = Math.min(Math.max(Number(c.req.query("limit")) || DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(Number(c.req.query("offset")) || 0, 0);

  const conditions: string[] = [];
  const binds: unknown[] = [];

  if (feedId) {
    conditions.push("a.feed_id = ?");
    binds.push(Number(feedId));
  }
  if (categoryId) {
    conditions.push("a.category_id = ?");
    binds.push(Number(categoryId));
  }
  if (unread) {
    conditions.push("a.seen_at IS NULL");
  }
  if (bookmarked) {
    conditions.push("a.bookmarked_at IS NOT NULL");
  }
  if (liked) {
    conditions.push("a.liked_at IS NOT NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy =
    sort === "score"
      ? "COALESCE(a.quality_score, 0) DESC"
      : "COALESCE(a.published_at, a.fetched_at) DESC";

  // Fetch limit+1 rows to determine has_more without a separate COUNT query
  const result = await c.env.DB.prepare(
    `SELECT a.id, a.feed_id, a.category_id, a.title, a.url, a.lang,
            a.excerpt, a.og_image, a.quality_score, a.seen_at, a.read_at,
            a.bookmarked_at, a.liked_at, a.published_at, a.fetched_at,
            f.name as feed_name
     FROM active_articles a
     LEFT JOIN feeds f ON a.feed_id = f.id
     ${where}
     ORDER BY ${orderBy}
     LIMIT ? OFFSET ?`,
  )
    .bind(...binds, limit + 1, offset)
    .all();

  const hasMore = result.results.length > limit;
  const articles = hasMore ? result.results.slice(0, limit) : result.results;
  return c.json({
    articles,
    total: offset + articles.length + (hasMore ? 1 : 0),
    has_more: hasMore,
  });
});

articleRoutes.get("/articles/by-url", async (c) => {
  const url = c.req.query("url");
  if (!url) return c.json({ error: "url query parameter is required" }, 400);

  const article = await c.env.DB.prepare(
    `SELECT a.id, a.feed_id, a.category_id, a.title, a.url, a.lang,
            a.excerpt, a.og_image, a.quality_score, a.seen_at, a.read_at,
            a.bookmarked_at, a.liked_at, a.published_at, a.fetched_at,
            a.full_text, a.full_text_translated, a.translated_lang,
            a.summary, a.images_archived_at,
            f.name as feed_name, f.type as feed_type
     FROM active_articles a
     LEFT JOIN feeds f ON a.feed_id = f.id
     WHERE a.url = ?`,
  )
    .bind(url)
    .first();

  if (!article) return c.json({ error: "Article not found" }, 404);
  return c.json(article);
});

articleRoutes.get("/articles/:id{[0-9]+}", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const article = await c.env.DB.prepare(
    `SELECT a.id, a.feed_id, a.category_id, a.title, a.url, a.lang,
            a.excerpt, a.og_image, a.quality_score, a.seen_at, a.read_at,
            a.bookmarked_at, a.liked_at, a.published_at, a.fetched_at,
            a.full_text, a.full_text_translated, a.translated_lang,
            a.summary, a.images_archived_at,
            f.name as feed_name, f.type as feed_type
     FROM active_articles a
     LEFT JOIN feeds f ON a.feed_id = f.id
     WHERE a.id = ?`,
  )
    .bind(id)
    .first();

  if (!article) return c.json({ error: "Article not found" }, 404);
  return c.json(article);
});

articleRoutes.patch("/articles/:id{[0-9]+}/seen", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{ seen: boolean }>();
  const seenAt = body.seen ? "datetime('now')" : "NULL";

  const result = await c.env.DB.prepare(
    `UPDATE articles SET seen_at = ${seenAt} WHERE id = ? AND purged_at IS NULL RETURNING id, seen_at`,
  )
    .bind(id)
    .first();

  if (!result) return c.json({ error: "Article not found" }, 404);
  return c.json(result);
});

articleRoutes.patch("/articles/:id{[0-9]+}/bookmark", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{ bookmarked: boolean }>();
  const val = body.bookmarked ? "datetime('now')" : "NULL";

  const result = await c.env.DB.prepare(
    `UPDATE articles SET bookmarked_at = ${val} WHERE id = ? AND purged_at IS NULL RETURNING id, bookmarked_at`,
  )
    .bind(id)
    .first();

  if (!result) return c.json({ error: "Article not found" }, 404);
  return c.json(result);
});

articleRoutes.patch("/articles/:id{[0-9]+}/like", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const body = await c.req.json<{ liked: boolean }>();
  const val = body.liked ? "datetime('now')" : "NULL";

  const result = await c.env.DB.prepare(
    `UPDATE articles SET liked_at = ${val} WHERE id = ? AND purged_at IS NULL RETURNING id, liked_at`,
  )
    .bind(id)
    .first();

  if (!result) return c.json({ error: "Article not found" }, 404);
  return c.json(result);
});

articleRoutes.post("/articles/:id{[0-9]+}/read", async (c) => {
  const id = Number(c.req.param("id"));
  if (isNaN(id)) return c.json({ error: "Invalid id" }, 400);

  const result = await c.env.DB.prepare(
    `UPDATE articles SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now'))
     WHERE id = ? AND purged_at IS NULL RETURNING id, read_at, seen_at`,
  )
    .bind(id)
    .first();

  if (!result) return c.json({ error: "Article not found" }, 404);
  return c.json(result);
});

articleRoutes.post("/articles/batch-seen", async (c) => {
  const body = await c.req.json<{ ids: number[] }>();
  const { ids } = body;

  if (!Array.isArray(ids) || ids.length === 0) {
    return c.json({ error: "ids must be a non-empty array" }, 400);
  }
  if (ids.length > 100) {
    return c.json({ error: "ids must not exceed 100 items" }, 400);
  }

  const placeholders = ids.map(() => "?").join(", ");
  const result = await c.env.DB.prepare(
    `UPDATE articles SET seen_at = datetime('now')
     WHERE id IN (${placeholders}) AND purged_at IS NULL AND seen_at IS NULL`,
  )
    .bind(...ids)
    .run();

  return c.json({ updated: result.meta.changes });
});
