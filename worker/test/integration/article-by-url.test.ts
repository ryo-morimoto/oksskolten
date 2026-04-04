import { describe, it, expect, beforeEach } from "vitest";
import { setupTestDb, fetchApi, seedFeed, seedArticle } from "../helpers";

const api = (path: string, init?: RequestInit) => fetchApi(`/api${path}`, init);

describe("GET /api/articles/by-url", () => {
  let feedId: number;

  beforeEach(async () => {
    await setupTestDb();
    const feed = await seedFeed();
    feedId = feed.id as number;
  });

  it("returns full article when found by URL", async () => {
    await seedArticle(feedId, { title: "By URL Article", url: "https://example.com/article-1" });

    const res = await api(`/articles/by-url?url=${encodeURIComponent("https://example.com/article-1")}`);
    expect(res.status).toBe(200);
    const body = await res.json<{
      title: string;
      url: string;
      feed_name: string;
      full_text: string | null;
    }>();
    expect(body.title).toBe("By URL Article");
    expect(body.url).toBe("https://example.com/article-1");
    expect(body.feed_name).toBe("Test Feed");
  });

  it("returns 404 when URL does not match any article", async () => {
    const res = await api(`/articles/by-url?url=${encodeURIComponent("https://example.com/nonexistent")}`);
    expect(res.status).toBe(404);
  });

  it("returns 400 when url query parameter is missing", async () => {
    const res = await api("/articles/by-url");
    expect(res.status).toBe(400);
  });

  it("excludes purged articles", async () => {
    await seedArticle(feedId, {
      url: "https://example.com/purged-article",
      purged_at: new Date().toISOString(),
    });

    const res = await api(`/articles/by-url?url=${encodeURIComponent("https://example.com/purged-article")}`);
    expect(res.status).toBe(404);
  });

  it("includes full_text in the response", async () => {
    await seedArticle(feedId, {
      title: "Full Text Article",
      url: "https://example.com/full-text",
    });

    const res = await api(`/articles/by-url?url=${encodeURIComponent("https://example.com/full-text")}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ full_text: string | null }>();
    // full_text is set by seedArticle
    expect(body.full_text).toBeDefined();
  });
});
