import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:workers";
import { setupTestDb } from "../helpers";

describe("D1 migrations", () => {
  beforeEach(async () => {
    await setupTestDb();
  });

  it("creates all expected tables", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all<{ name: string }>();

    const tableNames = tables.results.map((r) => r.name);
    expect(tableNames).toContain("categories");
    expect(tableNames).toContain("feeds");
    expect(tableNames).toContain("articles");
    expect(tableNames).toContain("settings");
    expect(tableNames).toContain("api_keys");
  });

  it("creates the active_articles view", async () => {
    const views = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='view'").all<{
      name: string;
    }>();

    const viewNames = views.results.map((r) => r.name);
    expect(viewNames).toContain("active_articles");
  });

  it("active_articles excludes purged articles", async () => {
    const feed = await env.DB.prepare(
      "INSERT INTO feeds (name, url, type) VALUES ('f', 'https://f.com', 'rss') RETURNING id",
    ).first<{ id: number }>();
    const feedId = feed!.id;

    await env.DB.prepare("INSERT INTO articles (feed_id, title, url) VALUES (?, ?, ?)")
      .bind(feedId, "Active", "https://a.com/1")
      .run();

    await env.DB.prepare(
      "INSERT INTO articles (feed_id, title, url, purged_at) VALUES (?, ?, ?, datetime('now'))",
    )
      .bind(feedId, "Purged", "https://a.com/2")
      .run();

    const all = await env.DB.prepare("SELECT COUNT(*) as count FROM articles").first<{
      count: number;
    }>();
    expect(all!.count).toBe(2);

    const active = await env.DB.prepare("SELECT COUNT(*) as count FROM active_articles").first<{
      count: number;
    }>();
    expect(active!.count).toBe(1);
  });

  it("articles table has FTS5 token columns", async () => {
    const columns = await env.DB.prepare("PRAGMA table_info('articles')").all<{ name: string }>();

    const columnNames = columns.results.map((r) => r.name);
    expect(columnNames).toContain("title_tokens");
    expect(columnNames).toContain("full_text_tokens");
  });

  it("enforces unique feed URL constraint", async () => {
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, type) VALUES ('f1', 'https://same.com', 'rss')",
    ).run();

    await expect(
      env.DB.prepare(
        "INSERT INTO feeds (name, url, type) VALUES ('f2', 'https://same.com', 'rss')",
      ).run(),
    ).rejects.toThrow();
  });

  it("enforces unique article URL constraint", async () => {
    const feed = await env.DB.prepare(
      "INSERT INTO feeds (name, url, type) VALUES ('f', 'https://f.com', 'rss') RETURNING id",
    ).first<{ id: number }>();

    await env.DB.prepare("INSERT INTO articles (feed_id, title, url) VALUES (?, ?, ?)")
      .bind(feed!.id, "a1", "https://a.com/same")
      .run();

    await expect(
      env.DB.prepare("INSERT INTO articles (feed_id, title, url) VALUES (?, ?, ?)")
        .bind(feed!.id, "a2", "https://a.com/same")
        .run(),
    ).rejects.toThrow();
  });
});
