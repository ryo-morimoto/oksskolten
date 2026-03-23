import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb, fetchApi, seedFeed } from "../helpers";

const api = (path: string, init?: RequestInit) => fetchApi(`/api${path}`, init);

const jsonApi = (path: string, method: string, body: unknown) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("Feed CRUD API", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  describe("GET /api/feeds", () => {
    it("returns empty list initially", async () => {
      const res = await api("/feeds");
      expect(res.status).toBe(200);
      const body = await res.json<{ feeds: unknown[] }>();
      expect(body.feeds).toHaveLength(0);
    });

    it("returns feeds with article counts", async () => {
      const feed = await seedFeed();
      // Insert an article
      await env.DB.prepare(
        "INSERT INTO articles (feed_id, title, url) VALUES (?, 'A', 'https://a.com/1')",
      )
        .bind(feed.id as number)
        .run();

      const res = await api("/feeds");
      const body = await res.json<{ feeds: { article_count: number; unread_count: number }[] }>();
      expect(body.feeds).toHaveLength(1);
      expect(body.feeds[0]?.article_count).toBe(1);
      expect(body.feeds[0]?.unread_count).toBe(1);
    });
  });

  describe("POST /api/feeds", () => {
    it("creates a feed", async () => {
      const res = await jsonApi("/feeds", "POST", {
        url: "https://blog.example.com",
        name: "Example Blog",
      });
      expect(res.status).toBe(201);
      const body = await res.json<{ name: string; url: string }>();
      expect(body.name).toBe("Example Blog");
      expect(body.url).toBe("https://blog.example.com");
    });

    it("uses hostname as name when name is omitted", async () => {
      const res = await jsonApi("/feeds", "POST", {
        url: "https://blog.example.com",
      });
      expect(res.status).toBe(201);
      const body = await res.json<{ name: string }>();
      expect(body.name).toBe("blog.example.com");
    });

    it("returns 409 on duplicate URL", async () => {
      await seedFeed({ url: "https://dup.com" });
      const res = await jsonApi("/feeds", "POST", { url: "https://dup.com" });
      expect(res.status).toBe(409);
    });

    it("returns 400 when url is missing", async () => {
      const res = await jsonApi("/feeds", "POST", { name: "No URL" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/feeds/:id", () => {
    it("returns a feed by id", async () => {
      const feed = await seedFeed();
      const res = await api(`/feeds/${feed.id}`);
      expect(res.status).toBe(200);
      const body = await res.json<{ url: string }>();
      expect(body.url).toBe("https://example.com");
    });

    it("returns 404 for nonexistent feed", async () => {
      const res = await api("/feeds/99999");
      expect(res.status).toBe(404);
    });
  });

  describe("PATCH /api/feeds/:id", () => {
    it("updates feed name", async () => {
      const feed = await seedFeed();
      const res = await jsonApi(`/feeds/${feed.id}`, "PATCH", {
        name: "Updated Name",
      });
      expect(res.status).toBe(200);
      const body = await res.json<{ name: string }>();
      expect(body.name).toBe("Updated Name");
    });

    it("cascades category_id to articles", async () => {
      const feed = await seedFeed();
      await env.DB.prepare(
        "INSERT INTO articles (feed_id, title, url) VALUES (?, 'A', 'https://a.com/1')",
      )
        .bind(feed.id as number)
        .run();

      // Create a category
      const cat = await env.DB.prepare(
        "INSERT INTO categories (name) VALUES ('Tech') RETURNING id",
      ).first<{ id: number }>();

      await jsonApi(`/feeds/${feed.id}`, "PATCH", {
        category_id: cat!.id,
      });

      const article = await env.DB.prepare("SELECT category_id FROM articles WHERE feed_id = ?")
        .bind(feed.id as number)
        .first<{ category_id: number }>();
      expect(article!.category_id).toBe(cat!.id);
    });

    it("returns 404 for nonexistent feed", async () => {
      const res = await jsonApi("/feeds/99999", "PATCH", { name: "X" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/feeds/:id", () => {
    it("deletes a feed", async () => {
      const feed = await seedFeed();
      const res = await api(`/feeds/${feed.id}`, { method: "DELETE" });
      expect(res.status).toBe(204);

      const check = await env.DB.prepare("SELECT * FROM feeds WHERE id = ?")
        .bind(feed.id as number)
        .first();
      expect(check).toBeNull();
    });

    it("returns 404 for nonexistent feed", async () => {
      const res = await api("/feeds/99999", { method: "DELETE" });
      expect(res.status).toBe(404);
    });

    it("prevents deleting clip feed", async () => {
      await env.DB.prepare(
        "INSERT INTO feeds (name, url, type) VALUES ('Clips', 'clip://saved', 'clip')",
      ).run();
      const clip = await env.DB.prepare("SELECT id FROM feeds WHERE type = 'clip'").first<{
        id: number;
      }>();

      const res = await api(`/feeds/${clip!.id}`, { method: "DELETE" });
      expect(res.status).toBe(403);
    });
  });
});
