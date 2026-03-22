import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMcpServer } from '../../src/mcp/server'
import { setupTestDb, seedFeed, seedArticle } from '../helpers'

/** Create a connected MCP client+server pair for testing. */
async function createTestClient() {
  const server = createMcpServer(env as never)
  const client = new Client({ name: 'test-client', version: '0.1.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

describe('MCP tools', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  it('lists all 12 tools', async () => {
    const client = await createTestClient()
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual([
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

  it('get_feeds returns feeds', async () => {
    await seedFeed({ name: 'MCP Test Feed' })
    const client = await createTestClient()
    const result = await client.callTool({ name: 'get_feeds', arguments: {} })
    const feeds = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(feeds).toHaveLength(1)
    expect(feeds[0].name).toBe('MCP Test Feed')
  })

  it('get_article returns article details', async () => {
    const feed = await seedFeed() as { id: number }
    const article = await seedArticle(feed.id, { title: 'MCP Article' }) as { id: number }
    const client = await createTestClient()
    const result = await client.callTool({ name: 'get_article', arguments: { id: article.id } })
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(data.title).toBe('MCP Article')
  })

  it('list_articles supports filtering and pagination', async () => {
    const feed = await seedFeed() as { id: number }
    await seedArticle(feed.id, { title: 'Article 1' })
    await seedArticle(feed.id, { title: 'Article 2' })
    const client = await createTestClient()
    const result = await client.callTool({ name: 'list_articles', arguments: { limit: 1 } })
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(data.articles).toHaveLength(1)
    expect(data.total).toBe(2)
    expect(data.has_more).toBe(true)
  })

  it('mark_as_read sets timestamps', async () => {
    const feed = await seedFeed() as { id: number }
    const article = await seedArticle(feed.id) as { id: number }
    const client = await createTestClient()
    const result = await client.callTool({ name: 'mark_as_read', arguments: { id: article.id } })
    const data = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(data.read_at).toBeTruthy()
    expect(data.seen_at).toBeTruthy()
  })

  it('toggle_bookmark bookmarks and unbookmarks', async () => {
    const feed = await seedFeed() as { id: number }
    const article = await seedArticle(feed.id) as { id: number }
    const client = await createTestClient()

    const r1 = await client.callTool({ name: 'toggle_bookmark', arguments: { id: article.id, bookmarked: true } })
    expect(JSON.parse((r1.content as Array<{ text: string }>)[0].text).bookmarked_at).toBeTruthy()

    const r2 = await client.callTool({ name: 'toggle_bookmark', arguments: { id: article.id, bookmarked: false } })
    expect(JSON.parse((r2.content as Array<{ text: string }>)[0].text).bookmarked_at).toBeNull()
  })

  it('get_reading_stats returns counts', async () => {
    const feed = await seedFeed() as { id: number }
    await seedArticle(feed.id)
    await seedArticle(feed.id)
    const client = await createTestClient()
    const result = await client.callTool({ name: 'get_reading_stats', arguments: {} })
    const stats = JSON.parse((result.content as Array<{ text: string }>)[0].text)
    expect(stats.total).toBe(2)
    expect(stats.unread).toBe(2)
  })

  it('get_article returns error for missing article', async () => {
    const client = await createTestClient()
    const result = await client.callTool({ name: 'get_article', arguments: { id: 99999 } })
    expect(result.isError).toBe(true)
  })
})
