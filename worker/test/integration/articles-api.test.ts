import { describe, it, expect, beforeEach } from 'vitest'
import { exports, env } from 'cloudflare:workers'
import { setupTestDb, seedApiKey, seedFeed, seedArticle } from '../helpers'

let apiKey: string

const api = (path: string, init?: RequestInit) =>
  exports.default.fetch(
    new Request(`https://test.host/api${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...init?.headers },
    }),
  )

const jsonApi = (path: string, method: string, body: unknown) =>
  api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('Article API', () => {
  let feedId: number

  beforeEach(async () => {
    await setupTestDb()
    apiKey = await seedApiKey()
    const feed = await seedFeed()
    feedId = feed.id as number
  })

  describe('GET /api/articles', () => {
    it('returns empty list initially', async () => {
      const res = await api('/articles')
      expect(res.status).toBe(200)
      const body = await res.json<{ articles: unknown[]; total: number }>()
      expect(body.articles).toHaveLength(0)
      expect(body.total).toBe(0)
    })

    it('returns articles with pagination', async () => {
      await seedArticle(feedId, { title: 'A1', url: 'https://a.com/1' })
      await seedArticle(feedId, { title: 'A2', url: 'https://a.com/2' })
      await seedArticle(feedId, { title: 'A3', url: 'https://a.com/3' })

      const res = await api('/articles?limit=2')
      const body = await res.json<{ articles: unknown[]; total: number; has_more: boolean }>()
      expect(body.articles).toHaveLength(2)
      expect(body.total).toBe(3)
      expect(body.has_more).toBe(true)
    })

    it('filters by feed_id', async () => {
      const feed2 = await seedFeed({ name: 'F2', url: 'https://f2.com' })
      await seedArticle(feedId, { title: 'Feed1 Article', url: 'https://a.com/f1' })
      await seedArticle(feed2.id as number, { title: 'Feed2 Article', url: 'https://a.com/f2' })

      const res = await api(`/articles?feed_id=${feedId}`)
      const body = await res.json<{ articles: { title: string }[]; total: number }>()
      expect(body.total).toBe(1)
      expect(body.articles[0].title).toBe('Feed1 Article')
    })

    it('filters by bookmarked', async () => {
      const a = await seedArticle(feedId)
      await env.DB.prepare(
        "UPDATE articles SET bookmarked_at = datetime('now') WHERE id = ?",
      ).bind(a.id as number).run()
      await seedArticle(feedId, { url: 'https://a.com/unbookmarked' })

      const res = await api('/articles?bookmarked=1')
      const body = await res.json<{ total: number }>()
      expect(body.total).toBe(1)
    })
  })

  describe('GET /api/articles/:id', () => {
    it('returns article detail with feed name', async () => {
      const a = await seedArticle(feedId)
      const res = await api(`/articles/${a.id}`)
      expect(res.status).toBe(200)
      const body = await res.json<{ title: string; feed_name: string; full_text: string }>()
      expect(body.title).toBe('Test Article')
      expect(body.feed_name).toBe('Test Feed')
      expect(body.full_text).toContain('test article')
    })

    it('returns 404 for nonexistent', async () => {
      const res = await api('/articles/99999')
      expect(res.status).toBe(404)
    })

    it('excludes purged articles', async () => {
      const a = await seedArticle(feedId, { purged_at: new Date().toISOString() })
      const res = await api(`/articles/${a.id}`)
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/articles/:id/seen', () => {
    it('marks article as seen', async () => {
      const a = await seedArticle(feedId)
      const res = await jsonApi(`/articles/${a.id}/seen`, 'PATCH', { seen: true })
      expect(res.status).toBe(200)
      const body = await res.json<{ seen_at: string | null }>()
      expect(body.seen_at).toBeTruthy()
    })

    it('unmarks article as seen', async () => {
      const a = await seedArticle(feedId)
      await jsonApi(`/articles/${a.id}/seen`, 'PATCH', { seen: true })
      const res = await jsonApi(`/articles/${a.id}/seen`, 'PATCH', { seen: false })
      const body = await res.json<{ seen_at: string | null }>()
      expect(body.seen_at).toBeNull()
    })
  })

  describe('PATCH /api/articles/:id/bookmark', () => {
    it('toggles bookmark', async () => {
      const a = await seedArticle(feedId)
      const res = await jsonApi(`/articles/${a.id}/bookmark`, 'PATCH', { bookmarked: true })
      expect(res.status).toBe(200)
      const body = await res.json<{ bookmarked_at: string | null }>()
      expect(body.bookmarked_at).toBeTruthy()
    })
  })

  describe('PATCH /api/articles/:id/like', () => {
    it('toggles like', async () => {
      const a = await seedArticle(feedId)
      const res = await jsonApi(`/articles/${a.id}/like`, 'PATCH', { liked: true })
      expect(res.status).toBe(200)
      const body = await res.json<{ liked_at: string | null }>()
      expect(body.liked_at).toBeTruthy()
    })
  })

  describe('POST /api/articles/:id/read', () => {
    it('records read and auto-marks seen', async () => {
      const a = await seedArticle(feedId)
      const res = await jsonApi(`/articles/${a.id}/read`, 'POST', {})
      expect(res.status).toBe(200)
      const body = await res.json<{ read_at: string; seen_at: string }>()
      expect(body.read_at).toBeTruthy()
      expect(body.seen_at).toBeTruthy()
    })
  })
})
