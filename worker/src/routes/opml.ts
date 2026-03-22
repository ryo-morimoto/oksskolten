import { Hono } from 'hono'
import { XMLParser } from 'fast-xml-parser'
import type { AppContext } from '../index'
import { requireScope } from '../auth/bearer'

export const opmlRoutes = new Hono<AppContext>()

// --- OPML Export ---

opmlRoutes.get('/opml', async (c) => {
  const feeds = await c.env.DB.prepare(
    "SELECT * FROM feeds WHERE type != 'clip' ORDER BY name COLLATE NOCASE",
  ).all<{
    id: number; name: string; url: string
    rss_url: string | null; rss_bridge_url: string | null
    category_id: number | null; type: string
  }>()

  const categories = await c.env.DB.prepare(
    'SELECT * FROM categories ORDER BY sort_order ASC',
  ).all<{ id: number; name: string }>()

  const categoryMap = new Map(categories.results.map((c) => [c.id, c.name]))

  // Group feeds by category
  const grouped = new Map<string | null, typeof feeds.results>()
  for (const feed of feeds.results) {
    const catName = feed.category_id ? (categoryMap.get(feed.category_id) ?? null) : null
    if (!grouped.has(catName)) grouped.set(catName, [])
    grouped.get(catName)!.push(feed)
  }

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    '  <head>',
    '    <title>Oksskolten Feeds</title>',
    `    <dateCreated>${new Date().toISOString()}</dateCreated>`,
    '  </head>',
    '  <body>',
  ]

  // Categorized feeds
  for (const [catName, catFeeds] of grouped) {
    if (catName === null) continue
    lines.push(`    <outline text="${escapeXml(catName)}" title="${escapeXml(catName)}">`)
    for (const feed of catFeeds) {
      lines.push(feedToOutline(feed, '      '))
    }
    lines.push('    </outline>')
  }

  // Uncategorized feeds
  for (const feed of grouped.get(null) ?? []) {
    lines.push(feedToOutline(feed, '    '))
  }

  lines.push('  </body>', '</opml>')

  return new Response(lines.join('\n'), {
    headers: {
      'Content-Type': 'application/xml',
      'Content-Disposition': 'attachment; filename="oksskolten.opml"',
    },
  })
})

// --- OPML Import ---

opmlRoutes.post('/opml', requireScope('write'), async (c) => {
  const body = await c.req.text()
  if (!body) return c.json({ error: 'No OPML data' }, 400)

  let parsed: ParsedFeed[]
  try {
    parsed = parseOpml(body)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Invalid OPML' }, 400)
  }

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  // Pre-fetch existing categories
  const existingCategories = await c.env.DB.prepare(
    'SELECT * FROM categories',
  ).all<{ id: number; name: string }>()
  const categoryByName = new Map(
    existingCategories.results.map((cat) => [cat.name.toLowerCase(), cat]),
  )

  for (const entry of parsed) {
    try {
      // Check duplicate
      const existing = await c.env.DB.prepare(
        'SELECT id FROM feeds WHERE url = ?',
      ).bind(entry.url).first()
      if (existing) { skipped++; continue }

      // Resolve category
      let categoryId: number | null = null
      if (entry.categoryName) {
        const existingCat = categoryByName.get(entry.categoryName.toLowerCase())
        if (existingCat) {
          categoryId = existingCat.id
        } else {
          const maxOrder = await c.env.DB.prepare(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories',
          ).first<{ next: number }>()
          const created = await c.env.DB.prepare(
            'INSERT INTO categories (name, sort_order) VALUES (?, ?) RETURNING *',
          ).bind(entry.categoryName, maxOrder!.next).first<{ id: number; name: string }>()
          categoryByName.set(entry.categoryName.toLowerCase(), created!)
          categoryId = created!.id
        }
      }

      await c.env.DB.prepare(
        'INSERT INTO feeds (name, url, rss_url, category_id) VALUES (?, ?, ?, ?)',
      ).bind(entry.name, entry.url, entry.rssUrl, categoryId).run()
      imported++
    } catch (err) {
      errors.push(`${entry.name}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  return c.json({ imported, skipped, errors })
})

// --- Helpers ---

interface ParsedFeed {
  name: string
  url: string
  rssUrl: string
  categoryName: string | null
}

interface OpmlOutline {
  '@_text'?: string
  '@_title'?: string
  '@_xmlUrl'?: string
  '@_htmlUrl'?: string
  outline?: OpmlOutline | OpmlOutline[]
}

function parseOpml(xml: string): ParsedFeed[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    isArray: (name: string) => name === 'outline',
  })
  const doc = parser.parse(xml)

  const body = doc?.opml?.body
  if (!body) throw new Error('Invalid OPML: missing <body>')

  const outlines: OpmlOutline[] = Array.isArray(body.outline) ? body.outline : body.outline ? [body.outline] : []
  const feeds: ParsedFeed[] = []
  walkOutlines(outlines, null, feeds)
  return feeds
}

function walkOutlines(outlines: OpmlOutline[], categoryName: string | null, feeds: ParsedFeed[]): void {
  for (const outline of outlines) {
    if (outline['@_xmlUrl']) {
      const rssUrl = outline['@_xmlUrl']
      const htmlUrl = outline['@_htmlUrl']
      const url = htmlUrl || new URL(rssUrl).origin
      const name = outline['@_text'] || outline['@_title'] || new URL(rssUrl).hostname
      feeds.push({ name, url, rssUrl, categoryName })
    } else if (outline.outline) {
      const catName = outline['@_text'] || outline['@_title'] || null
      const children = Array.isArray(outline.outline) ? outline.outline : [outline.outline]
      walkOutlines(children, catName, feeds)
    }
  }
}

function escapeXml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function feedToOutline(
  feed: { name: string; url: string; rss_url: string | null; rss_bridge_url: string | null },
  indent: string,
): string {
  const attrs = [
    'type="rss"',
    `text="${escapeXml(feed.name)}"`,
    `title="${escapeXml(feed.name)}"`,
    `xmlUrl="${escapeXml(feed.rss_url || feed.rss_bridge_url || feed.url)}"`,
    `htmlUrl="${escapeXml(feed.url)}"`,
  ]
  return `${indent}<outline ${attrs.join(' ')} />`
}
