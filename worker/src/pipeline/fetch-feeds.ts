import type { Env } from '../index'
import type { ArticlePipelineParams } from './article-workflow'

/**
 * Cron Trigger handler: query all enabled feeds due for check
 * and start a Workflow instance for each.
 *
 * Backpressure: deterministic instance ID prevents duplicate runs.
 */
export async function startFeedWorkflows(env: Env): Promise<number> {
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

  // Use hour-level timestamp for deterministic IDs (prevents duplicate within same cron window)
  const cronTimestamp = new Date().toISOString().slice(0, 13) // "2026-03-22T16"

  let started = 0
  for (const feed of feeds) {
    const instanceId = `feed-${feed.id}-${cronTimestamp}`
    const params: ArticlePipelineParams = {
      feedId: feed.id,
      feedName: feed.name,
      rssUrl: feed.rss_url,
      etag: feed.etag,
      lastModified: feed.last_modified,
      lastContentHash: feed.last_content_hash,
      checkInterval: feed.check_interval,
    }

    try {
      await env.ARTICLE_PIPELINE.create({ id: instanceId, params })
      started++
    } catch (err) {
      // Likely already running (duplicate ID) — skip silently
      if (
        err instanceof Error &&
        err.message.includes('already exists')
      ) {
        continue
      }
      console.error(
        `Failed to start workflow for feed ${feed.name} (${feed.id}):`,
        err,
      )
    }
  }

  return started
}
