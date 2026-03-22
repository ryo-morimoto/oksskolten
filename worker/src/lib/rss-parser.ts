/**
 * RSS/Atom/RDF feed parser for Cloudflare Workers.
 * Ported from fork's rss.ts — uses feedsmith + fast-xml-parser.
 * Stripped: FlareSolverr, SSRF, RSS Bridge, JSDOM.
 */

import type { RssItem } from './schedule'
import { cleanUrl } from './url-cleaner'

/**
 * Normalize a date string to ISO format or return null.
 */
export function normalizeDate(raw: string | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/**
 * Parse RSS/Atom/RDF XML into a list of items.
 */
export async function parseRssXml(xml: string): Promise<RssItem[]> {
  // Try feedsmith first
  try {
    const { parseFeed } = await import('feedsmith')
    const parsed = parseFeed(xml) as Record<string, unknown>
    const feed = parsed.feed as Record<string, unknown> | undefined
    const items = (parsed.items ?? parsed.entries ?? feed?.items ?? feed?.entries) as
      | Record<string, unknown>[]
      | undefined
    if (items && items.length > 0) {
      return cleanItems(
        items
          .filter((item) => {
            if (item.url || item.link) return true
            const links = item.links as { href?: string; rel?: string }[] | undefined
            if (links?.length) return true
            const id = item.id as string | undefined
            return id ? /^https?:\/\//i.test(id) : false
          })
          .map((item) => {
            let url = (item.url || item.link) as string | undefined
            if (!url) {
              const links = item.links as { href?: string; rel?: string }[] | undefined
              if (links?.length) {
                const alt = links.find((l) => l.rel === 'alternate')
                url = alt?.href || links[0]?.href
              }
            }
            const rawExcerpt =
              item.content_encoded ||
              item['content:encoded'] ||
              item.content ||
              item.description ||
              item.summary
            const excerpt =
              typeof rawExcerpt === 'string'
                ? rawExcerpt
                : rawExcerpt &&
                    typeof rawExcerpt === 'object' &&
                    'value' in rawExcerpt
                  ? String((rawExcerpt as Record<string, unknown>).value)
                  : undefined
            return {
              title: (item.title as string) || 'Untitled',
              url: (url || item.id) as string,
              published_at: normalizeDate(
                (item.published ||
                  item.updated ||
                  item.date ||
                  item.pubDate ||
                  (item.dc as Record<string, unknown>)?.date) as string | undefined,
              ),
              ...(excerpt ? { excerpt } : {}),
            }
          }),
      )
    }
  } catch {
    // feedsmith failed, fall through to fast-xml-parser
  }

  // Fallback: fast-xml-parser
  const { XMLParser } = await import('fast-xml-parser')
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  })
  const doc = parser.parse(xml)

  function textOf(val: unknown): string {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && '#text' in val)
      return String((val as Record<string, unknown>)['#text'])
    return ''
  }

  // RSS 2.0
  const channel = doc?.rss?.channel
  if (channel?.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item]
    return cleanItems(
      items
        .map((item: Record<string, unknown>) => {
          const excerpt =
            textOf(item['content:encoded']) || textOf(item.description)
          return {
            title: textOf(item.title) || 'Untitled',
            url: (item.link || item.guid || '') as string,
            published_at: normalizeDate(item.pubDate as string | undefined),
            ...(excerpt ? { excerpt } : {}),
          }
        })
        .filter((item: RssItem) => item.url),
    )
  }

  // Atom
  const atomFeed = doc?.feed
  if (atomFeed?.entry) {
    const entries = Array.isArray(atomFeed.entry)
      ? atomFeed.entry
      : [atomFeed.entry]
    return cleanItems(
      entries
        .map((entry: Record<string, unknown>) => {
          const link = Array.isArray(entry.link)
            ? (entry.link as Record<string, string>[]).find(
                (l) => l['@_rel'] === 'alternate',
              )?.['@_href'] ||
              (entry.link as Record<string, string>[])[0]?.['@_href']
            : (entry.link as Record<string, string>)?.['@_href'] ||
              (entry.link as string)
          const id = entry.id as string | undefined
          const effectiveUrl =
            link || (id && /^https?:\/\//i.test(id) ? id : '') || ''
          const excerpt =
            textOf(entry.content) || textOf(entry.summary)
          return {
            title: textOf(entry.title) || 'Untitled',
            url: effectiveUrl,
            published_at: normalizeDate(
              (entry.published || entry.updated) as string | undefined,
            ),
            ...(excerpt ? { excerpt } : {}),
          }
        })
        .filter((item: RssItem) => item.url),
    )
  }

  // RSS 1.0 (RDF)
  const rdf = doc?.['rdf:RDF']
  const rdfItem = rdf?.item
  if (rdfItem) {
    const items = Array.isArray(rdfItem) ? rdfItem : [rdfItem]
    return cleanItems(
      items
        .map((item: Record<string, unknown>) => ({
          title: textOf(item.title) || 'Untitled',
          url: (item.link || item['@_rdf:about'] || '') as string,
          published_at: normalizeDate(
            (item['dc:date'] ?? item.pubDate) as string | undefined,
          ),
        }))
        .filter((item: RssItem) => item.url),
    )
  }

  throw new Error('Could not parse RSS/Atom feed')
}

function cleanItems(items: RssItem[]): RssItem[] {
  return items.map((item) => ({ ...item, url: cleanUrl(item.url) }))
}
