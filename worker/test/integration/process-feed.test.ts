import { describe, it, expect, beforeEach, vi } from 'vitest'
import { env } from 'cloudflare:workers'
import { setupTestDb } from '../helpers'
import type { FeedQueueMessage } from '../../src/pipeline/fetch-feeds'

// Sample RSS feed XML for testing
const SAMPLE_RSS = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>New Article</title>
      <link>https://example.com/new-article</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Another Article</title>
      <link>https://example.com/another</link>
      <pubDate>Sun, 31 Dec 2023 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`

describe('process-feed pipeline', () => {
  let feedId: number

  beforeEach(async () => {
    await setupTestDb()

    const feed = await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type) VALUES ('Test', 'https://example.com', 'https://example.com/feed.xml', 'rss') RETURNING id",
    ).first<{ id: number }>()
    feedId = feed!.id

    // Mock global fetch to return our sample RSS
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url === 'https://example.com/feed.xml') {
          return new Response(SAMPLE_RSS, {
            status: 200,
            headers: {
              'Content-Type': 'application/xml',
              ETag: '"abc123"',
            },
          })
        }
        return new Response('Not Found', { status: 404 })
      }),
    )
  })

  it('fetches RSS and saves new articles to D1', async () => {
    const { processFeedBatch } = await import(
      '../../src/pipeline/process-feed'
    )

    const message: FeedQueueMessage = {
      feedId,
      feedName: 'Test',
      rssUrl: 'https://example.com/feed.xml',
      etag: null,
      lastModified: null,
      lastContentHash: null,
      checkInterval: null,
      requiresJsChallenge: false,
    }

    // Create a mock MessageBatch
    const acked: boolean[] = []
    const retried: boolean[] = []
    const batch = {
      messages: [
        {
          body: message,
          ack: () => acked.push(true),
          retry: () => retried.push(true),
          id: '1',
          timestamp: new Date(),
          attempts: 1,
        },
      ],
      queue: 'oksskolten-feeds',
      ackAll: () => {},
      retryAll: () => {},
    } as unknown as MessageBatch<FeedQueueMessage>

    await processFeedBatch(batch, {
      DB: env.DB,
      FEED_QUEUE: env.FEED_QUEUE,
      ENVIRONMENT: 'test',
    })

    expect(acked).toHaveLength(1)
    expect(retried).toHaveLength(0)

    // Check articles were inserted
    const articles = await env.DB.prepare(
      'SELECT * FROM active_articles WHERE feed_id = ? ORDER BY url',
    )
      .bind(feedId)
      .all<{ title: string; url: string }>()

    expect(articles.results).toHaveLength(2)
    expect(articles.results[0].title).toBe('Another Article')
    expect(articles.results[1].title).toBe('New Article')

    // Check feed was updated with cache headers
    const updatedFeed = await env.DB.prepare(
      'SELECT etag, last_error, error_count FROM feeds WHERE id = ?',
    )
      .bind(feedId)
      .first<{ etag: string; last_error: string | null; error_count: number }>()

    expect(updatedFeed!.etag).toBe('"abc123"')
    expect(updatedFeed!.last_error).toBeNull()
    expect(updatedFeed!.error_count).toBe(0)
  })

  it('skips duplicate articles on second run', async () => {
    const { processFeedBatch } = await import(
      '../../src/pipeline/process-feed'
    )

    const message: FeedQueueMessage = {
      feedId,
      feedName: 'Test',
      rssUrl: 'https://example.com/feed.xml',
      etag: null,
      lastModified: null,
      lastContentHash: null,
      checkInterval: null,
      requiresJsChallenge: false,
    }

    const makeBatch = () =>
      ({
        messages: [
          {
            body: message,
            ack: () => {},
            retry: () => {},
            id: '1',
            timestamp: new Date(),
            attempts: 1,
          },
        ],
        queue: 'oksskolten-feeds',
        ackAll: () => {},
        retryAll: () => {},
      }) as unknown as MessageBatch<FeedQueueMessage>

    const envObj = { DB: env.DB, FEED_QUEUE: env.FEED_QUEUE, ENVIRONMENT: 'test' }

    // First run: inserts 2 articles
    await processFeedBatch(makeBatch(), envObj)
    const first = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE feed_id = ?',
    )
      .bind(feedId)
      .first<{ count: number }>()
    expect(first!.count).toBe(2)

    // Update lastContentHash to force re-parse (otherwise content hash match skips)
    message.lastContentHash = null

    // Second run: no new articles (dedup by URL)
    await processFeedBatch(makeBatch(), envObj)
    const second = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE feed_id = ?',
    )
      .bind(feedId)
      .first<{ count: number }>()
    expect(second!.count).toBe(2) // Still 2, not 4
  })

  it('handles 304 Not Modified', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 304 })),
    )

    const { processFeedBatch } = await import(
      '../../src/pipeline/process-feed'
    )

    const message: FeedQueueMessage = {
      feedId,
      feedName: 'Test',
      rssUrl: 'https://example.com/feed.xml',
      etag: '"old"',
      lastModified: null,
      lastContentHash: null,
      checkInterval: 3600,
      requiresJsChallenge: false,
    }

    const batch = {
      messages: [
        {
          body: message,
          ack: () => {},
          retry: () => {},
          id: '1',
          timestamp: new Date(),
          attempts: 1,
        },
      ],
      queue: 'oksskolten-feeds',
      ackAll: () => {},
      retryAll: () => {},
    } as unknown as MessageBatch<FeedQueueMessage>

    await processFeedBatch(batch, {
      DB: env.DB,
      FEED_QUEUE: env.FEED_QUEUE,
      ENVIRONMENT: 'test',
    })

    // No articles should be inserted
    const count = await env.DB.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE feed_id = ?',
    )
      .bind(feedId)
      .first<{ count: number }>()
    expect(count!.count).toBe(0)

    // Feed should have updated schedule
    const feed = await env.DB.prepare(
      'SELECT next_check_at FROM feeds WHERE id = ?',
    )
      .bind(feedId)
      .first<{ next_check_at: string }>()
    expect(feed!.next_check_at).toBeTruthy()
  })
})
