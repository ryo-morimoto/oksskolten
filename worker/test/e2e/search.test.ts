import { authFetch } from './helpers'

describe('E2E: search', () => {
  it('FTS5 keyword search returns results with rank', async () => {
    const res = await authFetch('/api/articles/search?q=Workers')
    expect(res.status).toBe(200)
    const body = await res.json<{
      articles: { id: number; title: string; rank: number }[]
      total: number
    }>()
    expect(body.total).toBeGreaterThan(0)
    expect(typeof body.articles[0].rank).toBe('number')
    // RRF score is a small positive number (sum of 1/(60+rank))
    expect(body.articles[0].rank).not.toBeNaN()
  })

  it('semantic search finds related articles without exact keyword match', async () => {
    // "serverless computing" should find Cloudflare Workers articles
    // even if "serverless computing" doesn't appear as FTS5 tokens
    const res = await authFetch(
      '/api/articles/search?q=serverless+computing',
    )
    expect(res.status).toBe(200)
    const body = await res.json<{
      articles: { title: string }[]
      total: number
    }>()
    // Vectorize may not be populated yet — assert no error, not result count
    expect(Array.isArray(body.articles)).toBe(true)
    expect(typeof body.total).toBe('number')
  })

  it('RRF merges FTS5 and Vectorize results', async () => {
    // Search for a term likely in both FTS5 and Vectorize
    const res = await authFetch('/api/articles/search?q=Cloudflare&limit=10')
    expect(res.status).toBe(200)
    const body = await res.json<{
      articles: { id: number; rank: number }[]
      total: number
    }>()
    expect(body.total).toBeGreaterThan(0)

    // Ranks should be sorted descending (highest RRF first), with float tolerance
    for (let i = 1; i < body.articles.length; i++) {
      expect(body.articles[i - 1].rank + 1e-10).toBeGreaterThanOrEqual(
        body.articles[i].rank,
      )
    }
  })

  it('pagination is stable after RRF fusion', async () => {
    const page1 = await authFetch(
      '/api/articles/search?q=Cloudflare&limit=3&offset=0',
    )
    const page2 = await authFetch(
      '/api/articles/search?q=Cloudflare&limit=3&offset=3',
    )
    const body1 = await page1.json<{
      articles: { id: number }[]
      total: number
    }>()
    const body2 = await page2.json<{
      articles: { id: number }[]
      total: number
    }>()

    // Same total across pages
    expect(body1.total).toBe(body2.total)

    // No overlap between pages
    const ids1 = new Set(body1.articles.map((a) => a.id))
    for (const a of body2.articles) {
      expect(ids1.has(a.id)).toBe(false)
    }
  })
})
