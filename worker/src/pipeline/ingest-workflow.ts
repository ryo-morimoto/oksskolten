import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers";
import { parseRssXml } from "../lib/rss-parser";
import { extractEmbedding } from "../lib/search";
import { plainExcerpt } from "../lib/text";
import {
  computeInterval,
  computeEmpiricalInterval,
  parseHttpCacheInterval,
  parseRssTtl,
  sqliteFuture,
  DEFAULT_INTERVAL,
} from "../lib/schedule";
import type { Env } from "../index";

const USER_AGENT = "Mozilla/5.0 (compatible; Oksskolten/1.0)";
const FETCH_TIMEOUT = 15_000;

export interface IngestParams {
  feedId: number;
  feedName: string;
  rssUrl: string;
  etag: string | null;
  lastModified: string | null;
  lastContentHash: string | null;
  checkInterval: number | null;
}

export class IngestWorkflow extends WorkflowEntrypoint<Env, IngestParams> {
  async run(event: WorkflowEvent<IngestParams>, step: WorkflowStep) {
    const feed = event.payload;

    // Step 1: fetch_and_save — fetch + parse + dedup + INSERT (all in one step to avoid 1MiB output limit)
    const fetchResult = await step.do(
      "fetch_and_save",
      {
        retries: { limit: 3, delay: "5 second", backoff: "exponential" },
        timeout: "30 seconds",
      },
      async () => {
        const headers: Record<string, string> = {
          "User-Agent": USER_AGENT,
        };
        if (feed.etag) headers["If-None-Match"] = feed.etag;
        if (feed.lastModified) headers["If-Modified-Since"] = feed.lastModified;

        const res = await fetch(feed.rssUrl, {
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        });

        // Rate limiting
        if (res.status === 429 || res.status === 503) {
          const retryAfter = res.headers.get("retry-after");
          const delay = retryAfter ? parseInt(retryAfter, 10) || 3600 : 3600;
          await this.env.DB.prepare(
            "UPDATE feeds SET next_check_at = ?, last_error = ? WHERE id = ?",
          )
            .bind(sqliteFuture(delay), `Rate limited, retry after ${delay}s`, feed.feedId)
            .run();
          return { skipped: true };
        }

        // 304 Not Modified
        if (res.status === 304) {
          const interval = feed.checkInterval ?? DEFAULT_INTERVAL;
          await this.env.DB.prepare(
            "UPDATE feeds SET next_check_at = ?, check_interval = ? WHERE id = ?",
          )
            .bind(sqliteFuture(interval), interval, feed.feedId)
            .run();
          return { skipped: true };
        }

        if (!res.ok) {
          await recordFeedError(this.env, feed.feedId, `HTTP ${res.status}`);
          return { skipped: true };
        }

        const xml = await res.text();

        // Content hash check
        const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(xml));
        const contentHash = [...new Uint8Array(hashBuffer)]
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        if (feed.lastContentHash && feed.lastContentHash === contentHash) {
          const interval = feed.checkInterval ?? DEFAULT_INTERVAL;
          await this.env.DB.prepare(
            `UPDATE feeds SET next_check_at = ?, check_interval = ?,
             etag = ?, last_modified = ?, last_content_hash = ? WHERE id = ?`,
          )
            .bind(
              sqliteFuture(interval),
              interval,
              res.headers.get("etag"),
              res.headers.get("last-modified"),
              contentHash,
              feed.feedId,
            )
            .run();
          return { skipped: true };
        }

        // Parse — catch failures so recordFeedError is called (Workflow retry alone won't update DB)
        let items: Awaited<ReturnType<typeof parseRssXml>>;
        try {
          items = await parseRssXml(xml, feed.rssUrl);
        } catch (e) {
          await recordFeedError(
            this.env,
            feed.feedId,
            e instanceof Error ? e.message : "Parse error",
          );
          return { skipped: true };
        }

        // Compute schedule
        const empirical = computeEmpiricalInterval(items);
        const httpCache = parseHttpCacheInterval(res.headers);
        const rssTtl = parseRssTtl(xml);
        const interval = computeInterval(httpCache, rssTtl, empirical);

        // Normalize URLs so raw-Unicode and percent-encoded forms match
        for (const item of items) {
          item.url = normalizeUrl(item.url);
        }

        // Dedup + save — INSERT OR IGNORE (url UNIQUE = idempotent)
        const urls = items.map((i) => i.url);
        const existing = await getExistingUrls(this.env, urls);
        const newItems = items.filter((item) => !existing.has(item.url));

        let insertedCount = 0;
        if (newItems.length > 0) {
          const batchSize = 50;
          for (let i = 0; i < newItems.length; i += batchSize) {
            const chunk = newItems.slice(i, i + batchSize);
            await this.env.DB.batch(
              chunk.map((item) =>
                this.env.DB.prepare(
                  `INSERT OR IGNORE INTO articles (feed_id, title, url, excerpt, published_at)
                 VALUES (?, ?, ?, ?, ?)`,
                ).bind(
                  feed.feedId,
                  item.title,
                  item.url,
                  plainExcerpt(item.excerpt),
                  item.published_at,
                ),
              ),
            );
          }
          insertedCount = newItems.length;
        }

        return {
          skipped: false,
          insertedCount,
          interval,
          contentHash,
          newEtag: res.headers.get("etag"),
          newLastModified: res.headers.get("last-modified"),
        };
      },
    );

    if (!fetchResult.skipped) {
      // Step 2: extract_content — Defuddle (WHERE full_text IS NULL = idempotent)
      await step.do(
        "extract_content",
        {
          retries: { limit: 2, delay: "5 second", backoff: "exponential" },
          timeout: "2 minutes",
        },
        async () => {
          const articles = await this.env.DB.prepare(
            `SELECT id, url, excerpt FROM articles
           WHERE feed_id = ? AND full_text IS NULL
           ORDER BY id DESC LIMIT ?`,
          )
            .bind(feed.feedId, Math.max(fetchResult.insertedCount, 10))
            .all<{ id: number; url: string; excerpt: string | null }>();

          for (const article of articles.results) {
            try {
              const pageRes = await fetch(article.url, {
                headers: { "User-Agent": USER_AGENT },
                signal: AbortSignal.timeout(FETCH_TIMEOUT),
              });
              if (!pageRes.ok) continue;

              const html = await pageRes.text();
              const { extractContent } = await import("./extract-content");
              const content = await extractContent(html, article.url, {
                fallbackContent: article.excerpt ?? undefined,
              });

              if (content.fullText) {
                await this.env.DB.prepare(
                  `UPDATE articles
                 SET full_text = ?, og_image = ?,
                     excerpt = COALESCE(?, excerpt),
                     title = COALESCE(?, title)
                 WHERE id = ?`,
                )
                  .bind(
                    content.fullText,
                    content.ogImage,
                    content.excerpt,
                    content.title,
                    article.id,
                  )
                  .run();
              }
            } catch {
              // Content extraction is best-effort
            }
          }

          return { extractedCount: articles.results.length };
        },
      );
    } // end !fetchResult.skipped

    // Final: update feed metadata (skipped fetch: no-op here — fetch_and_save already updated DB)
    await step.do("update_feed_metadata", async () => {
      if (fetchResult.skipped) return;
      await this.env.DB.prepare(
        `UPDATE feeds
         SET next_check_at = ?, check_interval = ?,
             etag = ?, last_modified = ?, last_content_hash = ?,
             last_error = NULL, error_count = 0
         WHERE id = ?`,
      )
        .bind(
          sqliteFuture(fetchResult.interval),
          fetchResult.interval,
          fetchResult.newEtag,
          fetchResult.newLastModified,
          fetchResult.contentHash,
          feed.feedId,
        )
        .run();
    });

    await embedArticles(step, this.env, feed.feedId);
  }
}

/**
 * Embed up to 20 unembedded articles for a feed (title + excerpt → Vectorize).
 * Shared by full pipeline and skipped-fetch backfill paths.
 */
export async function embedArticles(step: WorkflowStep, env: Env, feedId: number): Promise<void> {
  // Return only IDs to stay well under the 1MiB step-output limit
  const ids = await step.do("embed_query", async () => {
    const result = await env.DB.prepare(
      `SELECT id FROM active_articles
       WHERE feed_id = ? AND embedded_at IS NULL AND title IS NOT NULL
       LIMIT 20`,
    )
      .bind(feedId)
      .all<{ id: number }>();
    return result.results.map((a) => a.id);
  });

  for (const id of ids) {
    await step.do(
      `embed_${id}`,
      {
        retries: {
          limit: 2,
          delay: "10 second",
          backoff: "exponential",
        },
        timeout: "2 minutes",
      },
      async () => {
        // Re-query article data inside the step (article may have been purged during replay)
        const article = await env.DB.prepare(
          "SELECT title, full_text, excerpt FROM articles WHERE id = ?",
        )
          .bind(id)
          .first<{ title: string; full_text: string | null; excerpt: string | null }>();
        if (!article) return { articleId: id, skipped: true };

        // bge-m3 supports 8192 tokens; truncate body to ~6000 chars to stay within limit
        const rawBody = article.full_text || article.excerpt || "";
        const body = rawBody.length > 6000 ? rawBody.slice(0, 6000) : rawBody;
        const text = `${article.title} ${body}`.trim();
        const embedResult = await env.AI.run("@cf/baai/bge-m3", {
          text: [text],
        });
        const values = extractEmbedding(embedResult);

        await env.VECTORIZE.upsert([
          {
            id: String(id),
            values,
            metadata: { feed_id: feedId },
          },
        ]);

        await env.DB.prepare(
          "UPDATE articles SET embedded_at = datetime('now') WHERE id = ? AND embedded_at IS NULL",
        )
          .bind(id)
          .run();

        return { articleId: id };
      },
    );
  }
}

// --- Utility functions ---

/** Normalize a URL so that raw-Unicode and percent-encoded forms compare equal. */
function normalizeUrl(raw: string): string {
  try {
    return new URL(raw).href;
  } catch {
    return raw;
  }
}

async function getExistingUrls(env: Env, urls: string[]): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const set = new Set<string>();
  const batchSize = 50;
  for (let i = 0; i < urls.length; i += batchSize) {
    const chunk = urls.slice(i, i + batchSize).map(normalizeUrl);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await env.DB.prepare(`SELECT url FROM articles WHERE url IN (${placeholders})`)
      .bind(...chunk)
      .all<{ url: string }>();
    for (const row of result.results) set.add(row.url);
  }
  return set;
}

async function recordFeedError(env: Env, feedId: number, error: string): Promise<void> {
  await env.DB.prepare(
    "UPDATE feeds SET last_error = ?, error_count = error_count + 1 WHERE id = ?",
  )
    .bind(error, feedId)
    .run();

  const feed = await env.DB.prepare("SELECT error_count FROM feeds WHERE id = ?")
    .bind(feedId)
    .first<{ error_count: number }>();

  if (feed && feed.error_count >= 3) {
    // Escalating backoff: 1h-4h (3-5 errors), 24h (6-9), 72h (10+)
    let backoff: number;
    if (feed.error_count >= 10) {
      backoff = 72 * 3600;
    } else if (feed.error_count >= 6) {
      backoff = 24 * 3600;
    } else {
      const BACKOFF_BASE = 3600;
      const MAX_BACKOFF = 4 * 3600;
      backoff = Math.min(MAX_BACKOFF, BACKOFF_BASE * (feed.error_count - 2));
    }
    await env.DB.prepare("UPDATE feeds SET next_check_at = ? WHERE id = ?")
      .bind(sqliteFuture(backoff), feedId)
      .run();
  }
}
