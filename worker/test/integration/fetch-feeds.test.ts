import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { setupTestDb } from '../helpers'
import { enqueueFeedChecks } from '../../src/pipeline/fetch-feeds'

describe('enqueueFeedChecks', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  it('enqueues only enabled feeds with rss_url due for check', async () => {
    // Due for check (no next_check_at)
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type) VALUES ('Active', 'https://a.com', 'https://a.com/rss', 'rss')",
    ).run()

    // Disabled feed
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type, disabled) VALUES ('Disabled', 'https://b.com', 'https://b.com/rss', 'rss', 1)",
    ).run()

    // No rss_url
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, type) VALUES ('No RSS', 'https://c.com', 'rss')",
    ).run()

    // Future next_check_at (not due)
    await env.DB.prepare(
      "INSERT INTO feeds (name, url, rss_url, type, next_check_at) VALUES ('Future', 'https://d.com', 'https://d.com/rss', 'rss', strftime('%Y-%m-%dT%H:%M:%SZ', 'now', '+1 hour'))",
    ).run()

    const enqueued = await enqueueFeedChecks({
      DB: env.DB,
      FEED_QUEUE: env.FEED_QUEUE,
      ENVIRONMENT: 'test',
    })

    expect(enqueued).toBe(1)
  })

  it('returns 0 when no feeds are due', async () => {
    const enqueued = await enqueueFeedChecks({
      DB: env.DB,
      FEED_QUEUE: env.FEED_QUEUE,
      ENVIRONMENT: 'test',
    })
    expect(enqueued).toBe(0)
  })
})
