import { env, exports } from 'cloudflare:workers'
import { setupTestDb, seedFeed, seedApiKey } from '../helpers'

describe('GET /api/articles/search', () => {
  let apiKey: string

  beforeEach(async () => {
    await setupTestDb()
    apiKey = await seedApiKey('read,write')
  })

  async function search(query: string, params: Record<string, string> = {}) {
    const qs = new URLSearchParams({ q: query, ...params }).toString()
    return exports.default.fetch(
      new Request(`https://test.host/api/articles/search?${qs}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    )
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
    const res = await exports.default.fetch(
      new Request('https://test.host/api/articles/search', {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 for short query', async () => {
    const res = await search('a')
    expect(res.status).toBe(400)
  })

  it('finds articles by Japanese tokens', async () => {
    const feed = await seedFeed()
    await insertArticleWithTokens(
      feed.id as number,
      '東京の天気予報',
      'https://example.com/tokyo-weather',
      '東京 天気 予報',
      '東京 都 天気 予報 晴れ',
    )
    await insertArticleWithTokens(
      feed.id as number,
      '大阪のグルメ',
      'https://example.com/osaka-food',
      '大阪 グルメ',
      '大阪 食べ物 グルメ ランチ',
    )

    const res = await search('東京')
    expect(res.status).toBe(200)
    const body = await res.json<{
      articles: { rank: number }[]
      total: number
    }>()
    expect(body.total).toBe(1)
    expect(body.articles.length).toBe(1)
    expect(typeof body.articles[0].rank).toBe('number')
  })

  it('excludes purged articles', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, full_text, title_tokens, purged_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(feed.id, 'Purged', 'https://example.com/purged', 'text', 'パージ テスト').run()

    const res = await search('パージ')
    expect(res.status).toBe(200)
    const body = await res.json<{ articles: unknown[]; total: number }>()
    expect(body.total).toBe(0)
  })

  it('sanitizes FTS5 special syntax', async () => {
    const feed = await seedFeed()
    await insertArticleWithTokens(
      feed.id as number,
      'Test',
      'https://example.com/test',
      'テスト 記事',
      'テスト 内容',
    )

    // These should not cause FTS5 syntax errors
    const res1 = await search('テスト AND OR NOT')
    expect(res1.status).toBe(200)

    const res2 = await search('テスト * ^ ()')
    expect(res2.status).toBe(200)

    const res3 = await search('"テスト"')
    expect(res3.status).toBe(200)
  })

  it('returns corrections from trigram dictionary', async () => {
    const feed = await seedFeed()
    await insertArticleWithTokens(
      feed.id as number,
      'プログラミング入門',
      'https://example.com/programming',
      'プログラミング 入門',
      'プログラミング 入門 初心者',
    )

    // Seed trigram dictionary with "プログラミング"
    await env.DB.prepare(
      'INSERT INTO term_dictionary (term) VALUES (?)',
    ).bind('プログラミング').run()
    const termRow = await env.DB.prepare(
      'SELECT id FROM term_dictionary WHERE term = ?',
    ).bind('プログラミング').first<{ id: number }>()

    // Build trigrams for "プログラミング"
    const chars = [...'プログラミング']
    for (let i = 0; i <= chars.length - 3; i++) {
      const tri = chars.slice(i, i + 3).join('')
      await env.DB.prepare(
        'INSERT OR IGNORE INTO term_trigrams (trigram, term_id) VALUES (?, ?)',
      ).bind(tri, termRow!.id).run()
    }

    // Search with typo "プログラミンク" (ク instead of グ)
    const res = await search('プログラミンク')
    expect(res.status).toBe(200)
    const body = await res.json<{ corrections: string[] }>()
    expect(body.corrections).toContain('プログラミング')
  })

  it('respects limit and offset', async () => {
    const feed = await seedFeed()
    for (let i = 0; i < 5; i++) {
      await insertArticleWithTokens(
        feed.id as number,
        `記事${i}`,
        `https://example.com/article-${i}`,
        'テスト 記事',
        'テスト 記事 内容',
      )
    }

    const res = await search('テスト', { limit: '2', offset: '0' })
    const body = await res.json<{ articles: unknown[]; total: number }>()
    expect(body.articles.length).toBe(2)
    expect(body.total).toBe(5)
  })
})
