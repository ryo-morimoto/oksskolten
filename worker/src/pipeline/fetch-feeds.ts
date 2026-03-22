import type { Env } from '../index'

export interface FeedQueueMessage {
  feedId: number
  feedName: string
  rssUrl: string
  etag: string | null
  lastModified: string | null
  lastContentHash: string | null
  checkInterval: number | null
  requiresJsChallenge: boolean
}

/**
 * Cron Trigger handler: query all enabled feeds due for check and enqueue each.
 */
export async function enqueueFeedChecks(env: Env): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT id, name, rss_url, etag, last_modified, last_content_hash,
            check_interval, requires_js_challenge
     FROM feeds
     WHERE disabled = 0
       AND type = 'rss'
       AND rss_url IS NOT NULL
       AND (next_check_at IS NULL OR next_check_at <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
  ).all<{
    id: number
    name: string
    rss_url: string
    etag: string | null
    last_modified: string | null
    last_content_hash: string | null
    check_interval: number | null
    requires_js_challenge: number
  }>()

  const feeds = result.results
  if (feeds.length === 0) return 0

  // Queue accepts batches of up to 100 messages
  const batchSize = 100
  for (let i = 0; i < feeds.length; i += batchSize) {
    const batch = feeds.slice(i, i + batchSize)
    await env.FEED_QUEUE.sendBatch(
      batch.map((f) => ({
        body: {
          feedId: f.id,
          feedName: f.name,
          rssUrl: f.rss_url,
          etag: f.etag,
          lastModified: f.last_modified,
          lastContentHash: f.last_content_hash,
          checkInterval: f.check_interval,
          requiresJsChallenge: !!f.requires_js_challenge,
        } satisfies FeedQueueMessage,
      })),
    )
  }

  return feeds.length
}
