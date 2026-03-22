import { BASE_URL, authFetch } from './helpers'

describe('E2E: smoke', () => {
  it('GET /api/health returns ok', async () => {
    const res = await fetch(`${BASE_URL}/api/health`)
    expect(res.status).toBe(200)
    const body = await res.json<{ ok: boolean }>()
    expect(body.ok).toBe(true)
  })

  it('GET /api/feeds returns feeds array', async () => {
    const res = await authFetch('/api/feeds')
    expect(res.status).toBe(200)
    const body = await res.json<{ feeds: unknown[] }>()
    expect(body.feeds.length).toBeGreaterThan(0)
  })

  it('GET /api/articles returns articles', async () => {
    const res = await authFetch('/api/articles?limit=1')
    expect(res.status).toBe(200)
    const body = await res.json<{ articles: { title: string }[] }>()
    expect(body.articles.length).toBeGreaterThan(0)
    expect(body.articles[0].title).toBeTruthy()
  })

  it('GET /api/articles/search returns results for keyword', async () => {
    const res = await authFetch('/api/articles/search?q=Cloudflare')
    expect(res.status).toBe(200)
    const body = await res.json<{
      articles: unknown[]
      total: number
      corrections: string[]
    }>()
    expect(body.total).toBeGreaterThan(0)
    expect(body.articles.length).toBeGreaterThan(0)
    expect(Array.isArray(body.corrections)).toBe(true)
  })

  it('rejects unauthenticated requests', async () => {
    const res = await fetch(`${BASE_URL}/api/feeds`)
    expect(res.status).toBe(401)
  })
})
