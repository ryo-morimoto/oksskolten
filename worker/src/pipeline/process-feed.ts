import type { Env } from '../index'
import type { FeedQueueMessage } from './fetch-feeds'
import { parseRssXml } from '../lib/rss-parser'
import {
  computeInterval,
  computeEmpiricalInterval,
  parseHttpCacheInterval,
  parseRssTtl,
  sqliteFuture,
  DEFAULT_INTERVAL,
} from '../lib/schedule'

const USER_AGENT = 'Mozilla/5.0 (compatible; Oksskolten/1.0)'
const FETCH_TIMEOUT = 15_000

/**
 * Queue consumer: process a batch of feed messages.
 */
export async function processFeedBatch(
  batch: MessageBatch<FeedQueueMessage>,
  env: Env,
): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await processSingleFeed(msg.body, env)
      msg.ack()
    } catch (err) {
      console.error(
        `Feed ${msg.body.feedName} (${msg.body.feedId}) failed:`,
        err,
      )
      msg.retry()
    }
  }
}

async function processSingleFeed(
  feed: FeedQueueMessage,
  env: Env,
): Promise<void> {
  // Step 1: Fetch RSS with conditional request headers
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (feed.etag) headers['If-None-Match'] = feed.etag
  if (feed.lastModified) headers['If-Modified-Since'] = feed.lastModified

  const res = await fetch(feed.rssUrl, {
    headers,
    signal: AbortSignal.timeout(FETCH_TIMEOUT),
  })

  // Handle rate limiting
  if (res.status === 429 || res.status === 503) {
    const retryAfter = res.headers.get('retry-after')
    const delay = retryAfter ? parseInt(retryAfter, 10) || 3600 : 3600
    await env.DB.prepare(
      'UPDATE feeds SET next_check_at = ?, last_error = ? WHERE id = ?',
    )
      .bind(sqliteFuture(delay), `Rate limited, retry after ${delay}s`, feed.feedId)
      .run()
    return
  }

  // Handle 304 Not Modified
  if (res.status === 304) {
    const interval = feed.checkInterval ?? DEFAULT_INTERVAL
    await env.DB.prepare(
      'UPDATE feeds SET next_check_at = ?, check_interval = ? WHERE id = ?',
    )
      .bind(sqliteFuture(interval), interval, feed.feedId)
      .run()
    return
  }

  if (!res.ok) {
    await recordFeedError(env, feed.feedId, `HTTP ${res.status}`)
    return
  }

  const xml = await res.text()

  // Content hash check: skip parsing if body is identical
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(xml),
  )
  const contentHash = [...new Uint8Array(hashBuffer)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  if (feed.lastContentHash && feed.lastContentHash === contentHash) {
    const interval = feed.checkInterval ?? DEFAULT_INTERVAL
    await env.DB.prepare(
      'UPDATE feeds SET next_check_at = ?, check_interval = ?, etag = ?, last_modified = ?, last_content_hash = ? WHERE id = ?',
    )
      .bind(
        sqliteFuture(interval),
        interval,
        res.headers.get('etag'),
        res.headers.get('last-modified'),
        contentHash,
        feed.feedId,
      )
      .run()
    return
  }

  // Step 2: Parse RSS XML
  let items
  try {
    items = await parseRssXml(xml)
  } catch (err) {
    await recordFeedError(
      env,
      feed.feedId,
      `Parse error: ${err instanceof Error ? err.message : String(err)}`,
    )
    return
  }

  // Step 3: Compute adaptive schedule
  const empirical = computeEmpiricalInterval(items)
  const httpCache = parseHttpCacheInterval(res.headers)
  const rssTtl = parseRssTtl(xml)
  const interval = computeInterval(httpCache, rssTtl, empirical)

  // Step 4: Filter out existing articles
  const urls = items.map((i) => i.url)
  const existing = await getExistingUrls(env, urls)
  const newItems = items.filter((item) => !existing.has(item.url))

  // Step 5: Insert new articles into D1
  if (newItems.length > 0) {
    // D1 batch limit is 100 statements
    const batchSize = 50
    for (let i = 0; i < newItems.length; i += batchSize) {
      const chunk = newItems.slice(i, i + batchSize)
      await env.DB.batch(
        chunk.map((item) =>
          env.DB.prepare(
            `INSERT OR IGNORE INTO articles (feed_id, title, url, excerpt, published_at)
             VALUES (?, ?, ?, ?, ?)`,
          ).bind(
            feed.feedId,
            item.title,
            item.url,
            item.excerpt ?? null,
            item.published_at,
          ),
        ),
      )
    }
  }

  // Step 5.5: Fetch full text for new articles via Defuddle
  if (newItems.length > 0) {
    const inserted = await env.DB.prepare(
      `SELECT id, url, excerpt FROM articles
       WHERE feed_id = ? AND full_text IS NULL
       ORDER BY id DESC LIMIT ?`,
    )
      .bind(feed.feedId, newItems.length)
      .all<{ id: number; url: string; excerpt: string | null }>()

    for (const article of inserted.results) {
      try {
        const pageRes = await fetch(article.url, {
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        })
        if (!pageRes.ok) continue

        const html = await pageRes.text()
        const { extractContent } = await import('./extract-content')
        const content = await extractContent(html, article.url, {
          fallbackContent: article.excerpt ?? undefined,
        })

        if (content.fullText) {
          await env.DB.prepare(
            `UPDATE articles
             SET full_text = ?, og_image = ?, excerpt = COALESCE(?, excerpt), title = COALESCE(?, title)
             WHERE id = ?`,
          )
            .bind(
              content.fullText,
              content.ogImage,
              content.excerpt,
              content.title,
              article.id,
            )
            .run()
        }
      } catch {
        // Content extraction is best-effort; article is already saved with metadata
      }
    }
  }

  // Step 6: Update feed metadata
  await env.DB.prepare(
    `UPDATE feeds
     SET next_check_at = ?, check_interval = ?,
         etag = ?, last_modified = ?, last_content_hash = ?,
         last_error = NULL, error_count = 0
     WHERE id = ?`,
  )
    .bind(
      sqliteFuture(interval),
      interval,
      res.headers.get('etag'),
      res.headers.get('last-modified'),
      contentHash,
      feed.feedId,
    )
    .run()
}

async function getExistingUrls(
  env: Env,
  urls: string[],
): Promise<Set<string>> {
  if (urls.length === 0) return new Set()

  // D1 doesn't support large IN clauses well, batch by 50
  const set = new Set<string>()
  const batchSize = 50
  for (let i = 0; i < urls.length; i += batchSize) {
    const chunk = urls.slice(i, i + batchSize)
    const placeholders = chunk.map(() => '?').join(',')
    const result = await env.DB.prepare(
      `SELECT url FROM articles WHERE url IN (${placeholders})`,
    )
      .bind(...chunk)
      .all<{ url: string }>()
    for (const row of result.results) set.add(row.url)
  }
  return set
}

async function recordFeedError(
  env: Env,
  feedId: number,
  error: string,
): Promise<void> {
  // Increment error_count and apply backoff
  await env.DB.prepare(
    'UPDATE feeds SET last_error = ?, error_count = error_count + 1 WHERE id = ?',
  )
    .bind(error, feedId)
    .run()

  const feed = await env.DB.prepare(
    'SELECT error_count FROM feeds WHERE id = ?',
  )
    .bind(feedId)
    .first<{ error_count: number }>()

  if (feed && feed.error_count >= 3) {
    const BACKOFF_BASE = 3600
    const MAX_BACKOFF = 4 * 3600
    const backoff = Math.min(MAX_BACKOFF, BACKOFF_BASE * (feed.error_count - 2))
    await env.DB.prepare(
      'UPDATE feeds SET next_check_at = ? WHERE id = ?',
    )
      .bind(sqliteFuture(backoff), feedId)
      .run()
  }
}
