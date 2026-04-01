import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb, fetchApi } from "../helpers";

const api = (path: string, init?: RequestInit) => fetchApi(`/api${path}`, init);

const jsonApi = (path: string, method: string, body: unknown) =>
  api(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("GET /api/settings/preferences", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("returns empty object when no settings exist", async () => {
    const res = await api("/settings/preferences");
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, string | null>>();
    expect(Object.keys(body)).toHaveLength(0);
  });

  it("returns all settings as key-value pairs", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark')").run();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('language', 'ja')").run();

    const res = await api("/settings/preferences");
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, string | null>>();
    expect(body.theme).toBe("dark");
    expect(body.language).toBe("ja");
  });
});

describe("PATCH /api/settings/preferences", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("upserts new key-value pairs", async () => {
    const res = await jsonApi("/settings/preferences", "PATCH", {
      theme: "light",
      language: "en",
    });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, string | null>>();
    expect(body.theme).toBe("light");
    expect(body.language).toBe("en");
  });

  it("updates existing keys", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark')").run();

    const res = await jsonApi("/settings/preferences", "PATCH", { theme: "light" });
    expect(res.status).toBe(200);
    const body = await res.json<Record<string, string | null>>();
    expect(body.theme).toBe("light");

    const row = await env.DB.prepare("SELECT COUNT(*) AS cnt FROM settings WHERE key = 'theme'")
      .first<{ cnt: number }>();
    expect(row?.cnt).toBe(1);
  });

  it("returns all current settings after partial update", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('theme', 'dark')").run();
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('language', 'ja')").run();

    const res = await jsonApi("/settings/preferences", "PATCH", { theme: "light" });
    const body = await res.json<Record<string, string | null>>();
    expect(body.theme).toBe("light");
    expect(body.language).toBe("ja");
  });
});

describe("GET /api/settings/profile", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("returns login and null language when no language setting", async () => {
    const res = await api("/settings/profile");
    expect(res.status).toBe(200);
    const body = await res.json<{ login: string; language: string | null }>();
    expect(typeof body.login).toBe("string");
    expect(body.language).toBeNull();
  });

  it("returns language from settings table", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('language', 'ja')").run();

    const res = await api("/settings/profile");
    expect(res.status).toBe(200);
    const body = await res.json<{ login: string; language: string | null }>();
    expect(body.language).toBe("ja");
  });
});

describe("GET /api/stats", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("returns zero counts when empty", async () => {
    const res = await api("/stats");
    expect(res.status).toBe(200);
    const body = await res.json<{
      total_articles: number;
      unread_articles: number;
      read_articles: number;
      bookmarked_articles: number;
      liked_articles: number;
      total_feeds: number;
      total_categories: number;
    }>();
    expect(body.total_articles).toBe(0);
    expect(body.unread_articles).toBe(0);
    expect(body.read_articles).toBe(0);
    expect(body.bookmarked_articles).toBe(0);
    expect(body.liked_articles).toBe(0);
    expect(body.total_feeds).toBe(0);
    expect(body.total_categories).toBe(0);
  });

  it("returns correct aggregate counts", async () => {
    const cat = await env.DB.prepare(
      "INSERT INTO categories (name) VALUES ('Tech') RETURNING id",
    ).first<{ id: number }>();
    const feed = await env.DB.prepare(
      "INSERT INTO feeds (name, url) VALUES ('F', 'https://f.com') RETURNING id",
    ).first<{ id: number }>();

    const fid = feed!.id;
    // 3 articles: 1 unseen, 1 seen+read, 1 bookmarked+liked
    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url) VALUES (?, 'A1', 'https://a.com/1')",
    )
      .bind(fid)
      .run();
    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url, seen_at, read_at) VALUES (?, 'A2', 'https://a.com/2', datetime('now'), datetime('now'))",
    )
      .bind(fid)
      .run();
    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url, bookmarked_at, liked_at) VALUES (?, 'A3', 'https://a.com/3', datetime('now'), datetime('now'))",
    )
      .bind(fid)
      .run();

    const res = await api("/stats");
    expect(res.status).toBe(200);
    const body = await res.json<{
      total_articles: number;
      unread_articles: number;
      read_articles: number;
      bookmarked_articles: number;
      liked_articles: number;
      total_feeds: number;
      total_categories: number;
    }>();
    expect(body.total_articles).toBe(3);
    expect(body.unread_articles).toBe(2); // A1 and A3 have no seen_at
    expect(body.read_articles).toBe(1);
    expect(body.bookmarked_articles).toBe(1);
    expect(body.liked_articles).toBe(1);
    expect(body.total_feeds).toBe(1);
    expect(body.total_categories).toBe(1);

    // Suppress unused variable lint
    void cat;
  });

  it("excludes purged articles from counts", async () => {
    const feed = await env.DB.prepare(
      "INSERT INTO feeds (name, url) VALUES ('F', 'https://f2.com') RETURNING id",
    ).first<{ id: number }>();
    const fid = feed!.id;

    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url) VALUES (?, 'Active', 'https://a.com/active')",
    )
      .bind(fid)
      .run();
    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url, purged_at) VALUES (?, 'Purged', 'https://a.com/purged', datetime('now'))",
    )
      .bind(fid)
      .run();

    const res = await api("/stats");
    const body = await res.json<{ total_articles: number }>();
    expect(body.total_articles).toBe(1);
  });
});
