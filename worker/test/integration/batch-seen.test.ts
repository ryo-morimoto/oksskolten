import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb, fetchApi, seedFeed, seedArticle } from "../helpers";

const api = (path: string, init?: RequestInit) => fetchApi(`/api${path}`, init);

const jsonApi = (path: string, method: string, body: unknown) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/articles/batch-seen", () => {
  let feedId: number;

  beforeEach(async () => {
    await setupTestDb();
    const feed = await seedFeed();
    feedId = feed.id as number;
  });

  it("marks multiple articles as seen", async () => {
    const a1 = await seedArticle(feedId, { url: "https://a.com/1" });
    const a2 = await seedArticle(feedId, { url: "https://a.com/2" });
    const a3 = await seedArticle(feedId, { url: "https://a.com/3" });

    const res = await jsonApi("/articles/batch-seen", "POST", {
      ids: [a1.id, a2.id, a3.id],
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ updated: number }>();
    expect(body.updated).toBe(3);

    const rows = await env.DB.prepare("SELECT seen_at FROM articles WHERE id IN (?, ?, ?)")
      .bind(a1.id, a2.id, a3.id)
      .all<{ seen_at: string | null }>();
    for (const row of rows.results) {
      expect(row.seen_at).toBeTruthy();
    }
  });

  it("does not double-count already-seen articles", async () => {
    const a1 = await seedArticle(feedId, { url: "https://a.com/1" });
    const a2 = await seedArticle(feedId, { url: "https://a.com/2" });

    // Pre-mark a1 as seen
    await env.DB.prepare("UPDATE articles SET seen_at = datetime('now') WHERE id = ?")
      .bind(a1.id)
      .run();

    const res = await jsonApi("/articles/batch-seen", "POST", {
      ids: [a1.id as number, a2.id as number],
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ updated: number }>();
    // Only a2 should be updated (a1 already seen)
    expect(body.updated).toBe(1);
  });

  it("returns 400 when ids is empty", async () => {
    const res = await jsonApi("/articles/batch-seen", "POST", { ids: [] });
    expect(res.status).toBe(400);
  });

  it("returns 400 when ids exceeds 100", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1);
    const res = await jsonApi("/articles/batch-seen", "POST", { ids });
    expect(res.status).toBe(400);
  });

  it("skips purged articles", async () => {
    const a = await seedArticle(feedId, {
      url: "https://a.com/purged",
      purged_at: new Date().toISOString(),
    });

    const res = await jsonApi("/articles/batch-seen", "POST", {
      ids: [a.id as number],
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ updated: number }>();
    expect(body.updated).toBe(0);
  });
});
