import { describe, it, expect, beforeEach } from 'vitest'
import { exports } from 'cloudflare:workers'
import { setupTestDb, seedApiKey, seedFeed, seedArticle } from '../helpers'

const fetch = (url: string, init?: RequestInit) =>
  exports.default.fetch(new Request(url, init))

/** Send a JSON-RPC request to the MCP endpoint. */
async function mcpCall(key: string, method: string, params?: unknown, id = 1) {
  return fetch('https://test.host/mcp', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id }),
  })
}

describe('MCP Streamable HTTP', () => {
  let apiKey: string

  beforeEach(async () => {
    await setupTestDb()
    apiKey = await seedApiKey('read,write')
  })

  describe('auth', () => {
    it('returns 401 without Authorization header', async () => {
      const res = await fetch('https://test.host/mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'initialize', id: 1 }),
      })
      expect(res.status).toBe(401)
    })
  })

  describe('initialize', () => {
    it('succeeds and returns server info', async () => {
      const res = await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { serverInfo: { name: string } } }
      expect(body.result.serverInfo.name).toBe('oksskolten')
    })
  })

  describe('tools/list', () => {
    it('lists all registered tools', async () => {
      // Initialize first
      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/list', {}, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { tools: Array<{ name: string }> } }
      const toolNames = body.result.tools.map((t) => t.name).sort()
      expect(toolNames).toEqual([
        'get_article',
        'get_categories',
        'get_feeds',
        'get_reading_stats',
        'get_recent_activity',
        'get_similar_articles',
        'get_user_preferences',
        'list_articles',
        'mark_as_read',
        'search_articles',
        'toggle_bookmark',
        'toggle_like',
      ])
    })
  })

  describe('tools/call', () => {
    it('get_feeds returns feeds', async () => {
      await seedFeed({ name: 'MCP Test Feed' })

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/call', {
        name: 'get_feeds',
        arguments: {},
      }, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { content: Array<{ text: string }> } }
      const feeds = JSON.parse(body.result.content[0].text)
      expect(feeds).toHaveLength(1)
      expect(feeds[0].name).toBe('MCP Test Feed')
    })

    it('get_article returns article details', async () => {
      const feed = await seedFeed() as { id: number }
      const article = await seedArticle(feed.id, { title: 'MCP Article' }) as { id: number }

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/call', {
        name: 'get_article',
        arguments: { id: article.id },
      }, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { content: Array<{ text: string }> } }
      const data = JSON.parse(body.result.content[0].text)
      expect(data.title).toBe('MCP Article')
    })

    it('list_articles supports filtering', async () => {
      const feed = await seedFeed() as { id: number }
      await seedArticle(feed.id, { title: 'Article 1' })
      await seedArticle(feed.id, { title: 'Article 2' })

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/call', {
        name: 'list_articles',
        arguments: { limit: 1 },
      }, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { content: Array<{ text: string }> } }
      const data = JSON.parse(body.result.content[0].text)
      expect(data.articles).toHaveLength(1)
      expect(data.total).toBe(2)
      expect(data.has_more).toBe(true)
    })

    it('mark_as_read marks article and returns timestamps', async () => {
      const feed = await seedFeed() as { id: number }
      const article = await seedArticle(feed.id) as { id: number }

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/call', {
        name: 'mark_as_read',
        arguments: { id: article.id },
      }, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { content: Array<{ text: string }> } }
      const data = JSON.parse(body.result.content[0].text)
      expect(data.read_at).toBeTruthy()
      expect(data.seen_at).toBeTruthy()
    })

    it('toggle_bookmark bookmarks and unbookmarks', async () => {
      const feed = await seedFeed() as { id: number }
      const article = await seedArticle(feed.id) as { id: number }

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res1 = await mcpCall(apiKey, 'tools/call', {
        name: 'toggle_bookmark',
        arguments: { id: article.id, bookmarked: true },
      }, 2)
      const body1 = await res1.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(body1.result.content[0].text).bookmarked_at).toBeTruthy()

      const res2 = await mcpCall(apiKey, 'tools/call', {
        name: 'toggle_bookmark',
        arguments: { id: article.id, bookmarked: false },
      }, 3)
      const body2 = await res2.json() as { result: { content: Array<{ text: string }> } }
      expect(JSON.parse(body2.result.content[0].text).bookmarked_at).toBeNull()
    })

    it('get_reading_stats returns counts', async () => {
      const feed = await seedFeed() as { id: number }
      await seedArticle(feed.id)
      await seedArticle(feed.id)

      await mcpCall(apiKey, 'initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '0.1.0' },
      })

      const res = await mcpCall(apiKey, 'tools/call', {
        name: 'get_reading_stats',
        arguments: {},
      }, 2)
      expect(res.status).toBe(200)
      const body = await res.json() as { result: { content: Array<{ text: string }> } }
      const stats = JSON.parse(body.result.content[0].text)
      expect(stats.total).toBe(2)
      expect(stats.unread).toBe(2)
    })
  })
})
