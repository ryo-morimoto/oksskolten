import {
  WorkflowEntrypoint,
  type WorkflowStep,
  type WorkflowEvent,
} from 'cloudflare:workers'
import { getContainer } from '@cloudflare/containers'
import { parseRssXml } from '../lib/rss-parser'
import {
  computeInterval,
  computeEmpiricalInterval,
  parseHttpCacheInterval,
  parseRssTtl,
  sqliteFuture,
  DEFAULT_INTERVAL,
} from '../lib/schedule'
import type { TokenizeResponse } from '../container/kuromoji'
import type { Env } from '../index'

const USER_AGENT = 'Mozilla/5.0 (compatible; Oksskolten/1.0)'
const FETCH_TIMEOUT = 15_000

export interface ArticlePipelineParams {
  feedId: number
  feedName: string
  rssUrl: string
  etag: string | null
  lastModified: string | null
  lastContentHash: string | null
  checkInterval: number | null
}

type FetchRssResult =
  | {
      skipped: true
    }
  | {
      skipped: false
      items: Array<{
        title: string
        url: string
        excerpt: string | null
        published_at: string | null
      }>
      interval: number
      contentHash: string
      newEtag: string | null
      newLastModified: string | null
    }

interface DedupResult {
  insertedCount: number
}

export class ArticlePipelineWorkflow extends WorkflowEntrypoint<
  Env,
  ArticlePipelineParams
> {
  async run(
    event: WorkflowEvent<ArticlePipelineParams>,
    step: WorkflowStep,
  ) {
    const feed = event.payload

    // Step 1: fetch_rss — fetch + parse + compute schedule
    const fetchResult = await step.do(
      'fetch_rss',
      {
        retries: { limit: 3, delay: '5 second', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const headers: Record<string, string> = {
          'User-Agent': USER_AGENT,
        }
        if (feed.etag) headers['If-None-Match'] = feed.etag
        if (feed.lastModified)
          headers['If-Modified-Since'] = feed.lastModified

        const res = await fetch(feed.rssUrl, {
          headers,
          signal: AbortSignal.timeout(FETCH_TIMEOUT),
        })

        // Rate limiting
        if (res.status === 429 || res.status === 503) {
          const retryAfter = res.headers.get('retry-after')
          const delay =
            retryAfter ? parseInt(retryAfter, 10) || 3600 : 3600
          await this.env.DB.prepare(
            'UPDATE feeds SET next_check_at = ?, last_error = ? WHERE id = ?',
          )
            .bind(
              sqliteFuture(delay),
              `Rate limited, retry after ${delay}s`,
              feed.feedId,
            )
            .run()
          return { skipped: true }
        }

        // 304 Not Modified
        if (res.status === 304) {
          const interval = feed.checkInterval ?? DEFAULT_INTERVAL
          await this.env.DB.prepare(
            'UPDATE feeds SET next_check_at = ?, check_interval = ? WHERE id = ?',
          )
            .bind(sqliteFuture(interval), interval, feed.feedId)
            .run()
          return { skipped: true }
        }

        if (!res.ok) {
          await recordFeedError(
            this.env,
            feed.feedId,
            `HTTP ${res.status}`,
          )
          return { skipped: true }
        }

        const xml = await res.text()

        // Content hash check
        const hashBuffer = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(xml),
        )
        const contentHash = [...new Uint8Array(hashBuffer)]
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')

        if (
          feed.lastContentHash &&
          feed.lastContentHash === contentHash
        ) {
          const interval = feed.checkInterval ?? DEFAULT_INTERVAL
          await this.env.DB.prepare(
            `UPDATE feeds SET next_check_at = ?, check_interval = ?,
             etag = ?, last_modified = ?, last_content_hash = ? WHERE id = ?`,
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
          return { skipped: true }
        }

        // Parse
        const items = await parseRssXml(xml)

        // Compute schedule
        const empirical = computeEmpiricalInterval(items)
        const httpCache = parseHttpCacheInterval(res.headers)
        const rssTtl = parseRssTtl(xml)
        const interval = computeInterval(httpCache, rssTtl, empirical)

        return {
          skipped: false,
          items,
          interval,
          contentHash,
          newEtag: res.headers.get('etag'),
          newLastModified: res.headers.get('last-modified'),
        }
      },
    )

    if (!fetchResult.skipped) {
    // Step 2: dedup_and_save — INSERT OR IGNORE (url UNIQUE = idempotent)
    const dedupResult = await step.do(
      'dedup_and_save',
      {
        retries: { limit: 3, delay: '5 second', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        const urls = fetchResult.items.map((i) => i.url)
        const existing = await getExistingUrls(this.env, urls)
        const newItems = fetchResult.items.filter(
          (item) => !existing.has(item.url),
        )

        if (newItems.length === 0) return { insertedCount: 0 }

        const batchSize = 50
        for (let i = 0; i < newItems.length; i += batchSize) {
          const chunk = newItems.slice(i, i + batchSize)
          await this.env.DB.batch(
            chunk.map((item) =>
              this.env.DB.prepare(
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

        return { insertedCount: newItems.length } as DedupResult
      },
    )

    // Step 3: extract_content — Defuddle (WHERE full_text IS NULL = idempotent)
    await step.do(
      'extract_content',
      {
        retries: { limit: 2, delay: '5 second', backoff: 'exponential' },
        timeout: '2 minutes',
      },
      async () => {
        const articles = await this.env.DB.prepare(
          `SELECT id, url, excerpt FROM articles
           WHERE feed_id = ? AND full_text IS NULL
           ORDER BY id DESC LIMIT ?`,
        )
          .bind(feed.feedId, Math.max(dedupResult.insertedCount, 10))
          .all<{ id: number; url: string; excerpt: string | null }>()

        for (const article of articles.results) {
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
                .run()
            }
          } catch {
            // Content extraction is best-effort
          }
        }

        return { extractedCount: articles.results.length }
      },
    )

    // Step 4: tokenize — kuromoji Container (WHERE title_tokens IS NULL = idempotent)
    // Each article gets its own step to avoid DO-to-DO deadlock inside step.do
    const articlesToTokenize = await step.do(
      'tokenize_query',
      async () => {
        const result = await this.env.DB.prepare(
          `SELECT id, title, full_text FROM articles
           WHERE feed_id = ? AND title_tokens IS NULL AND full_text IS NOT NULL
           ORDER BY id DESC LIMIT 20`,
        )
          .bind(feed.feedId)
          .all<{
            id: number
            title: string
            full_text: string
          }>()
        return result.results.map((a) => ({
          id: a.id,
          title: a.title,
          fullText: a.full_text.slice(0, 10_000),
        }))
      },
    )

    for (const article of articlesToTokenize) {
      await step.do(
        `tokenize_${article.id}`,
        {
          retries: {
            limit: 2,
            delay: '10 second',
            backoff: 'exponential',
          },
          timeout: '2 minutes',
        },
        async () => {
          const container = getContainer(
            this.env.KUROMOJI_CONTAINER as any,
          )

          // Tokenize title
          const titleRes = await container.fetch(
            new Request('http://container/tokenize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: article.title }),
            }),
          )
          const titleData: TokenizeResponse = await titleRes.json()

          // Tokenize full_text
          const ftRes = await container.fetch(
            new Request('http://container/tokenize', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: article.fullText }),
            }),
          )
          const fullTextData: TokenizeResponse = await ftRes.json()

          await this.env.DB.prepare(
            `UPDATE articles
             SET title_tokens = ?, full_text_tokens = ?
             WHERE id = ? AND title_tokens IS NULL`,
          )
            .bind(titleData.tokens, fullTextData.tokens, article.id)
            .run()

          return {
            articleId: article.id,
            titleNouns: titleData.nouns,
            fullTextNouns: fullTextData.nouns,
          }
        },
      )
    }

    // Step 5: build_trigram — INSERT OR IGNORE (UNIQUE = idempotent)
    await step.do(
      'build_trigram',
      {
        retries: { limit: 2, delay: '5 second', backoff: 'exponential' },
        timeout: '30 seconds',
      },
      async () => {
        // Get recently tokenized articles' nouns via kuromoji
        const articles = await this.env.DB.prepare(
          `SELECT id, title_tokens, full_text_tokens FROM articles
           WHERE feed_id = ? AND title_tokens IS NOT NULL
           ORDER BY id DESC LIMIT 50`,
        )
          .bind(feed.feedId)
          .all<{
            id: number
            title_tokens: string
            full_text_tokens: string | null
          }>()

        // Extract unique terms (2+ chars) from tokens
        const termSet = new Set<string>()
        for (const article of articles.results) {
          const allTokens = [
            article.title_tokens,
            article.full_text_tokens ?? '',
          ].join(' ')
          for (const token of allTokens.split(/\s+/)) {
            if (token.length >= 2) termSet.add(token)
          }
        }

        if (termSet.size === 0) return { termsAdded: 0 }

        // Batch upsert terms into dictionary
        const terms = [...termSet]
        const batchSize = 50
        for (let i = 0; i < terms.length; i += batchSize) {
          const chunk = terms.slice(i, i + batchSize)
          await this.env.DB.batch(
            chunk.map((term) =>
              this.env.DB.prepare(
                `INSERT INTO term_dictionary (term) VALUES (?)
                 ON CONFLICT(term) DO UPDATE SET frequency = frequency + 1`,
              ).bind(term),
            ),
          )
        }

        // Build trigrams for new terms
        for (let i = 0; i < terms.length; i += batchSize) {
          const chunk = terms.slice(i, i + batchSize)
          // Get term IDs
          const placeholders = chunk.map(() => '?').join(',')
          const rows = await this.env.DB.prepare(
            `SELECT id, term FROM term_dictionary WHERE term IN (${placeholders})`,
          )
            .bind(...chunk)
            .all<{ id: number; term: string }>()

          const trigramInserts: D1PreparedStatement[] = []
          for (const row of rows.results) {
            const trigrams = decomposeTrigrams(row.term)
            for (const tri of trigrams) {
              trigramInserts.push(
                this.env.DB.prepare(
                  `INSERT OR IGNORE INTO term_trigrams (trigram, term_id) VALUES (?, ?)`,
                ).bind(tri, row.id),
              )
            }
          }

          if (trigramInserts.length > 0) {
            // D1 batch limit is 100
            for (let j = 0; j < trigramInserts.length; j += 100) {
              await this.env.DB.batch(trigramInserts.slice(j, j + 100))
            }
          }
        }

        return { termsAdded: terms.length }
      },
    )

    } // end !fetchResult.skipped

    // Final: update feed metadata (skipped fetch: no-op here — fetch_rss already updated DB)
    await step.do('update_feed_metadata', async () => {
      if (fetchResult.skipped) return
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
        .run()
    })

    await embedArticles(step, this.env, feed.feedId)
  }
}

/**
 * Embed up to 20 unembedded articles for a feed (title + excerpt → Vectorize).
 * Shared by full pipeline and skipped-fetch backfill paths.
 */
export async function embedArticles(
  step: WorkflowStep,
  env: Env,
  feedId: number,
): Promise<void> {
  const toEmbed = await step.do('embed_query', async () => {
    const result = await env.DB.prepare(
      `SELECT id, title, excerpt FROM active_articles
       WHERE feed_id = ? AND embedded_at IS NULL AND title IS NOT NULL
       LIMIT 20`,
    )
      .bind(feedId)
      .all<{ id: number; title: string; excerpt: string | null }>()
    return result.results.map((a) => ({
      id: a.id,
      title: a.title,
      excerpt: a.excerpt || '',
    }))
  })

  for (const article of toEmbed) {
    await step.do(
      `embed_${article.id}`,
      {
        retries: {
          limit: 2,
          delay: '10 second',
          backoff: 'exponential',
        },
        timeout: '2 minutes',
      },
      async () => {
        const text = `${article.title} ${article.excerpt}`.trim()
        const embedResult = await env.AI.run('@cf/baai/bge-m3', {
          text: [text],
        })
        const values = embedResult.data[0] as number[]

        await env.VECTORIZE.upsert([
          {
            id: String(article.id),
            values,
            metadata: { feed_id: feedId },
          },
        ])

        await env.DB.prepare(
          "UPDATE articles SET embedded_at = datetime('now') WHERE id = ? AND embedded_at IS NULL",
        )
          .bind(article.id)
          .run()

        return { articleId: article.id }
      },
    )
  }
}

// --- Utility functions ---

async function getExistingUrls(
  env: Env,
  urls: string[],
): Promise<Set<string>> {
  if (urls.length === 0) return new Set()
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
    const backoff = Math.min(
      MAX_BACKOFF,
      BACKOFF_BASE * (feed.error_count - 2),
    )
    await env.DB.prepare(
      'UPDATE feeds SET next_check_at = ? WHERE id = ?',
    )
      .bind(sqliteFuture(backoff), feedId)
      .run()
  }
}

/**
 * Decompose a term into character trigrams.
 * e.g. "東京都" → ["東京都"] (length 3 is itself a trigram)
 * e.g. "プログラミング" → ["プログ", "ログラ", "グラミ", "ラミン", "ミング"]
 */
export function decomposeTrigrams(term: string): string[] {
  const chars = [...term.normalize('NFC')] // handle multi-byte chars, normalize NFD→NFC
  if (chars.length < 3) return [term]
  const trigrams: string[] = []
  for (let i = 0; i <= chars.length - 3; i++) {
    trigrams.push(chars.slice(i, i + 3).join(''))
  }
  return trigrams
}

/**
 * Find correction candidates from trigram dictionary.
 * Returns terms ranked by trigram overlap with the query.
 */
export async function findTrigramCandidates(
  db: D1Database,
  query: string,
  limit = 3,
): Promise<string[]> {
  const trigrams = decomposeTrigrams(query)
  if (trigrams.length === 0) return []

  const placeholders = trigrams.map(() => '?').join(',')
  const result = await db
    .prepare(
      `SELECT td.term, COUNT(*) as match_count
       FROM term_trigrams tt
       JOIN term_dictionary td ON td.id = tt.term_id
       WHERE tt.trigram IN (${placeholders})
       GROUP BY tt.term_id
       ORDER BY match_count DESC, td.frequency DESC
       LIMIT ?`,
    )
    .bind(...trigrams, limit)
    .all<{ term: string; match_count: number }>()

  return result.results.map((r) => r.term)
}
