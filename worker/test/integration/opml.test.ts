import { describe, it, expect, beforeEach } from 'vitest'
import { exports, env } from 'cloudflare:workers'
import { setupTestDb, seedApiKey } from '../helpers'

let apiKey: string

const api = (path: string, init?: RequestInit) =>
  exports.default.fetch(
    new Request(`https://test.host/api${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${apiKey}`, ...init?.headers },
    }),
  )

const SAMPLE_OPML = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Blog A" xmlUrl="https://a.com/feed.xml" htmlUrl="https://a.com" />
      <outline type="rss" text="Blog B" xmlUrl="https://b.com/rss" htmlUrl="https://b.com" />
    </outline>
    <outline type="rss" text="Blog C" xmlUrl="https://c.com/atom.xml" htmlUrl="https://c.com" />
  </body>
</opml>`

describe('OPML', () => {
  beforeEach(async () => {
    await setupTestDb()
    apiKey = await seedApiKey()
  })

  describe('POST /api/opml (import)', () => {
    it('imports feeds with categories', async () => {
      const res = await api('/opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: SAMPLE_OPML,
      })
      expect(res.status).toBe(200)
      const body = await res.json<{ imported: number; skipped: number; errors: string[] }>()
      expect(body.imported).toBe(3)
      expect(body.skipped).toBe(0)
      expect(body.errors).toHaveLength(0)

      // Verify feeds created
      const feeds = await env.DB.prepare('SELECT * FROM feeds ORDER BY name').all()
      expect(feeds.results).toHaveLength(3)

      // Verify category created
      const cats = await env.DB.prepare('SELECT * FROM categories').all()
      expect(cats.results).toHaveLength(1)
      expect((cats.results[0] as { name: string }).name).toBe('Tech')
    })

    it('skips duplicate feeds', async () => {
      // First import
      await api('/opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: SAMPLE_OPML,
      })

      // Second import
      const res = await api('/opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: SAMPLE_OPML,
      })
      const body = await res.json<{ imported: number; skipped: number }>()
      expect(body.imported).toBe(0)
      expect(body.skipped).toBe(3)
    })

    it('returns 400 for invalid OPML', async () => {
      const res = await api('/opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: '<html>not opml</html>',
      })
      expect(res.status).toBe(400)
    })
  })

  describe('GET /api/opml (export)', () => {
    it('exports feeds as OPML XML', async () => {
      // Import first
      await api('/opml', {
        method: 'POST',
        headers: { 'Content-Type': 'application/xml' },
        body: SAMPLE_OPML,
      })

      const res = await api('/opml')
      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('application/xml')

      const xml = await res.text()
      expect(xml).toContain('<opml')
      expect(xml).toContain('Blog A')
      expect(xml).toContain('Blog B')
      expect(xml).toContain('Blog C')
      expect(xml).toContain('Tech')
    })

    it('returns valid OPML with no feeds', async () => {
      const res = await api('/opml')
      const xml = await res.text()
      expect(xml).toContain('<opml')
      expect(xml).toContain('</opml>')
    })
  })
})
