import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { createApiApp } from "../src/index";

const DATA_TABLES = [
  "articles",
  "feeds",
  "categories",
  "settings",
  "api_keys",
  "term_trigrams",
  "term_dictionary",
];

/**
 * Apply migrations (idempotent) and clear all data tables.
 * Call in beforeEach to ensure a clean state between tests.
 */
export async function setupTestDb() {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  // Rebuild FTS index before clearing data (prevents SQLITE_CORRUPT from stale FTS state)
  try {
    await env.DB.prepare("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')").run();
  } catch {
    // FTS table may not exist yet on first run
  }
  // Clear data in reverse-dependency order (articles before feeds)
  await env.DB.batch(DATA_TABLES.map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
}

/** Insert a test feed and return it. */
export async function seedFeed(
  overrides: Partial<{
    name: string;
    url: string;
    rss_url: string;
    type: string;
    category_id: number | null;
    disabled: number;
  }> = {},
) {
  const feed = {
    name: "Test Feed",
    url: "https://example.com",
    rss_url: "https://example.com/feed.xml",
    type: "rss",
    ...overrides,
  };
  const result = await env.DB.prepare(
    "INSERT INTO feeds (name, url, rss_url, type) VALUES (?, ?, ?, ?) RETURNING *",
  )
    .bind(feed.name, feed.url, feed.rss_url, feed.type)
    .first();
  return result!;
}

/**
 * Fetch against the API Hono app directly (bypasses OAuthProvider).
 * Guard is pass-through — auth is not the concern of integration tests.
 */
const testApp = createApiApp(async (_, next) => next());

export function fetchApi(path: string, init?: RequestInit) {
  return testApp.request(path, init, env);
}

/** Insert a test article and return it. */
export async function seedArticle(
  feedId: number,
  overrides: Partial<{
    title: string;
    url: string;
    full_text: string;
    published_at: string;
    purged_at: string | null;
    quality_score: number | null;
  }> = {},
) {
  const article = {
    title: "Test Article",
    url: `https://example.com/article/${crypto.randomUUID()}`,
    full_text: "# Test\n\nThis is a test article.",
    published_at: new Date().toISOString(),
    purged_at: null,
    quality_score: null as number | null,
    ...overrides,
  };
  const result = await env.DB.prepare(
    `INSERT INTO articles (feed_id, title, url, full_text, published_at, purged_at, quality_score)
     VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
  )
    .bind(
      feedId,
      article.title,
      article.url,
      article.full_text,
      article.published_at,
      article.purged_at,
      article.quality_score,
    )
    .first();
  return result!;
}
