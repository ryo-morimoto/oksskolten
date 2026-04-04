import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb, fetchApi, seedFeed, seedArticle } from "../helpers";

const api = (path: string, init?: RequestInit) => fetchApi(`/api${path}`, init);

const post = (path: string) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" } });

describe("POST /api/feeds/:id/mark-all-seen", () => {
  let feedId: number;

  beforeEach(async () => {
    await setupTestDb();
    const feed = await seedFeed();
    feedId = feed.id as number;
  });

  it("marks all unseen articles in the feed as seen", async () => {
    await seedArticle(feedId, { url: "https://a.com/1" });
    await seedArticle(feedId, { url: "https://a.com/2" });
    await seedArticle(feedId, { url: "https://a.com/3" });

    const res = await post(`/feeds/${feedId}/mark-all-seen`);
    expect(res.status).toBe(200);
    const body = await res.json<{ marked: number }>();
    expect(body.marked).toBe(3);

    const unseen = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM articles WHERE feed_id = ? AND seen_at IS NULL",
    )
      .bind(feedId)
      .first<{ cnt: number }>();
    expect(unseen?.cnt).toBe(0);
  });

  it("does not count already-seen articles", async () => {
    const a = await seedArticle(feedId, { url: "https://a.com/1" });
    await env.DB.prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?")
      .bind(a.id)
      .run();
    await seedArticle(feedId, { url: "https://a.com/2" });

    const res = await post(`/feeds/${feedId}/mark-all-seen`);
    const body = await res.json<{ marked: number }>();
    expect(body.marked).toBe(1);
  });

  it("returns 404 for nonexistent feed", async () => {
    const res = await post("/feeds/99999/mark-all-seen");
    expect(res.status).toBe(404);
  });

  it("does not affect other feeds", async () => {
    const feed2 = await seedFeed({ name: "F2", url: "https://f2.com" });
    await seedArticle(feedId, { url: "https://a.com/1" });
    await seedArticle(feed2.id as number, { url: "https://a.com/2" });

    await post(`/feeds/${feedId}/mark-all-seen`);

    const unseen = await env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM articles WHERE feed_id = ? AND seen_at IS NULL",
    )
      .bind(feed2.id)
      .first<{ cnt: number }>();
    expect(unseen?.cnt).toBe(1);
  });
});

describe("POST /api/articles/mark-all-seen", () => {
  let feedId: number;

  beforeEach(async () => {
    await setupTestDb();
    const feed = await seedFeed();
    feedId = feed.id as number;
  });

  const jsonPost = (body: unknown) =>
    api("/articles/mark-all-seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("marks unseen articles across feeds", async () => {
    const feed2 = await seedFeed({ name: "F2", url: "https://f2.com" });
    await seedArticle(feedId, { url: "https://a.com/1" });
    await seedArticle(feed2.id as number, { url: "https://a.com/2" });

    const res = await jsonPost({ feed_ids: [feedId, feed2.id as number] });
    expect(res.status).toBe(200);
    const body = await res.json<{ marked: number }>();
    expect(body.marked).toBe(2);
  });

  it("returns 400 when feed_ids is empty", async () => {
    const res = await jsonPost({ feed_ids: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when feed_ids exceeds 100", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await jsonPost({ feed_ids: ids });
    expect(res.status).toBe(400);
  });

  it("returns 400 for non-integer feed_ids", async () => {
    const res = await jsonPost({ feed_ids: [1.5] });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/categories/:id/mark-all-seen", () => {
  let feedId: number;
  let categoryId: number;

  beforeEach(async () => {
    await setupTestDb();
    const cat = await env.DB.prepare(
      "INSERT INTO categories (name) VALUES ('Tech') RETURNING id",
    ).first<{ id: number }>();
    categoryId = cat!.id;
    const feed = await seedFeed({ category_id: categoryId });
    feedId = feed.id as number;
    // Assign category_id on articles too (mirrors the cascade in feeds PATCH)
    await env.DB.prepare("UPDATE articles SET category_id = ? WHERE feed_id = ?")
      .bind(categoryId, feedId)
      .run();
  });

  it("marks all unseen articles in the category as seen", async () => {
    const a1 = await seedArticle(feedId, { url: "https://a.com/1" });
    const a2 = await seedArticle(feedId, { url: "https://a.com/2" });
    // Assign category_id
    await env.DB.prepare("UPDATE articles SET category_id = ? WHERE id IN (?, ?)")
      .bind(categoryId, a1.id, a2.id)
      .run();

    const res = await api(`/categories/${categoryId}/mark-all-seen`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ marked: number }>();
    expect(body.marked).toBe(2);
  });

  it("returns 404 for nonexistent category", async () => {
    const res = await api("/categories/99999/mark-all-seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });
});
