import { env } from 'cloudflare:workers'
import { setupTestDb, seedFeed, fetchApi } from '../helpers'

describe('GET /api/articles/search', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  async function search(query: string, params: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q: query, ...params }).toString()
    return fetchApi(`/api/articles/search?${qs}`)
  }

  async function insertArticleWithTokens(
    feedId: number,
    title: string,
    url: string,
    titleTokens: string,
    fullTextTokens: string,
  ) {
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, full_text, title_tokens, full_text_tokens)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(feedId, title, url, 'full text content', titleTokens, fullTextTokens).run()
  }

  it('returns 400 without q parameter', async () => {
    const res = await fetchApi('/api/articles/search')
    expect(res.status).toBe(400)
  })

  it('returns 400 for short query', async () => {
    const res = await search('a')
    expect(res.status).toBe(400)
  })

  it('returns empty for no matches', async () => {
    const res = await search('nonexistent')
    const body = await res.json<{ articles: unknown[]; total: number }>()
    expect(body.articles).toHaveLength(0)
    expect(body.total).toBe(0)
  })

  it('finds articles by FTS5 match', async () => {
    const feed = await seedFeed() as { id: number }
    // Rebuild FTS index
    await env.DB.prepare("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')").run()
    // Insert articles with tokens
    await insertArticleWithTokens(feed.id, 'Cloudflare Workers', 'https://example.com/1', 'cloudflare workers', 'cloudflare workers serverless')
    await insertArticleWithTokens(feed.id, 'React Hooks', 'https://example.com/2', 'react hooks', 'react hooks frontend')
    // Sync FTS
    await env.DB.prepare("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')").run()

    const res = await search('cloudflare')
    const body = await res.json<{ articles: Array<{ title: string }>; total: number }>()
    expect(body.total).toBe(1)
    expect(body.articles[0].title).toBe('Cloudflare Workers')
  })

  it('sanitizes FTS5 operators', async () => {
    const res = await search('AND OR NOT test')
    expect(res.status).toBe(200)
  })

  it('supports pagination', async () => {
    const feed = await seedFeed() as { id: number }
    await env.DB.prepare("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')").run()
    for (let i = 0; i < 5; i++) {
      await insertArticleWithTokens(feed.id, `テスト記事${i}`, `https://example.com/${i}`, 'テスト', 'テスト 記事')
    }
    await env.DB.prepare("INSERT INTO articles_fts(articles_fts) VALUES ('rebuild')").run()

    const res = await search('テスト', { limit: '2', offset: '0' })
    const body = await res.json<{ articles: unknown[]; total: number }>()
    expect(body.articles.length).toBe(2)
    expect(body.total).toBe(5)
  })

  it('returns corrections for typos', async () => {
    const feed = await seedFeed() as { id: number }
    // Insert a term in the dictionary
    await env.DB.prepare('INSERT INTO term_dictionary (term, frequency) VALUES (?, ?)').bind('cloudflare', 10).run()
    // Insert trigrams for the term
    const trigrams = ['clo', 'lou', 'oud', 'udf', 'dfl', 'fla', 'lar', 'are']
    const termId = (await env.DB.prepare('SELECT id FROM term_dictionary WHERE term = ?').bind('cloudflare').first<{ id: number }>())!.id
    for (const tri of trigrams) {
      await env.DB.prepare('INSERT INTO term_trigrams (trigram, term_id) VALUES (?, ?)').bind(tri, termId).run()
    }

    const res = await search('cloudflar')
    const body = await res.json<{ corrections: string[] }>()
    expect(body.corrections).toContain('cloudflare')
  })
})
