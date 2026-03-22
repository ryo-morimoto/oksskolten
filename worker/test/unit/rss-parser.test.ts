import { describe, it, expect } from 'vitest'
import { parseRssXml, normalizeDate } from '../../src/lib/rss-parser'

describe('parseRssXml', () => {
  it('parses RSS 2.0', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <title>Test Feed</title>
          <item>
            <title>Article 1</title>
            <link>https://example.com/1</link>
            <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Article 2</title>
            <link>https://example.com/2</link>
            <description>An excerpt</description>
          </item>
        </channel>
      </rss>`

    const items = await parseRssXml(xml)
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('Article 1')
    expect(items[0].url).toBe('https://example.com/1')
    expect(items[0].published_at).toBeTruthy()
    expect(items[1].title).toBe('Article 2')
  })

  it('parses Atom', async () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Test Feed</title>
        <entry>
          <title>Entry 1</title>
          <link href="https://example.com/e1" rel="alternate"/>
          <published>2024-01-01T12:00:00Z</published>
        </entry>
      </feed>`

    const items = await parseRssXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Entry 1')
    expect(items[0].url).toBe('https://example.com/e1')
  })

  it('parses RSS 1.0 (RDF)', async () => {
    const xml = `<?xml version="1.0"?>
      <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
               xmlns:dc="http://purl.org/dc/elements/1.1/"
               xmlns="http://purl.org/rss/1.0/">
        <item rdf:about="https://example.com/r1">
          <title>RDF Item</title>
          <link>https://example.com/r1</link>
          <dc:date>2024-01-01T12:00:00Z</dc:date>
        </item>
      </rdf:RDF>`

    const items = await parseRssXml(xml)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('RDF Item')
  })

  it('cleans tracking params from URLs', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>Tracked</title>
            <link>https://example.com/post?utm_source=rss&amp;page=1</link>
          </item>
        </channel>
      </rss>`

    const items = await parseRssXml(xml)
    expect(items[0].url).toBe('https://example.com/post?page=1')
  })

  it('extracts description as excerpt', async () => {
    const xml = `<?xml version="1.0"?>
      <rss version="2.0">
        <channel>
          <item>
            <title>With Description</title>
            <link>https://example.com/post</link>
            <description>A short excerpt of the article</description>
          </item>
        </channel>
      </rss>`

    const items = await parseRssXml(xml)
    expect(items[0].excerpt).toContain('A short excerpt of the article')
  })

  it('throws on invalid XML', async () => {
    await expect(parseRssXml('<html><body>Not RSS</body></html>')).rejects.toThrow()
  })
})

describe('normalizeDate', () => {
  it('normalizes RFC 2822 date', () => {
    expect(normalizeDate('Mon, 01 Jan 2024 12:00:00 GMT')).toBe(
      '2024-01-01T12:00:00.000Z',
    )
  })

  it('normalizes ISO date', () => {
    expect(normalizeDate('2024-01-01T12:00:00Z')).toBe('2024-01-01T12:00:00.000Z')
  })

  it('returns null for undefined', () => {
    expect(normalizeDate(undefined)).toBeNull()
  })

  it('returns null for invalid date', () => {
    expect(normalizeDate('not-a-date')).toBeNull()
  })
})
