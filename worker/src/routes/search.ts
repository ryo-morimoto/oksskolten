import { Hono } from "hono";
import type { AppContext } from "../index";
import { hybridSearch } from "../lib/search";

export const searchRoutes = new Hono<AppContext>();

// Re-export for existing consumers (tests, MCP)
export { computeRrfScore, computeEngagement } from "../lib/search";

// GET /api/articles/search?q=...&limit=20&offset=0&feed_id=1
searchRoutes.get("/articles/search", async (c) => {
  const query = c.req.query("q");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 100);
  const offset = parseInt(c.req.query("offset") ?? "0", 10);
  const feedIdParam = c.req.query("feed_id");
  const feedId = feedIdParam ? parseInt(feedIdParam, 10) : undefined;

  if (!query || query.trim().length === 0) {
    return c.json({ error: "q parameter is required" }, 400);
  }

  if (query.trim().length < 2) {
    return c.json({ error: "query must be at least 2 characters" }, 400);
  }

  const result = await hybridSearch(c.env, query, limit, offset, feedId);
  return c.json(result);
});
