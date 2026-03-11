import { createHash } from 'node:crypto'
import { JSDOM } from 'jsdom'
import type { Feed } from '../db.js'
import { normalizeDate } from './util.js'
import { fetchHtml, USER_AGENT, DEFAULT_TIMEOUT, DISCOVERY_TIMEOUT, PROBE_TIMEOUT } from './http.js'
import { safeFetch } from './ssrf.js'
import { fetchViaFlareSolverr } from './flaresolverr.js'
import { parseHttpCacheInterval, parseRssTtl } from './schedule.js'
import { cleanUrl } from './url-cleaner.js'
import {
  isCssSelectorBridgeUrl,
  stripCustomBridgeParams,
  fetchCssSelectorViaFlareSolverr,
  assignCssBridgePseudoDates,
  fixGenericTitlesAndEnrichExcerpts,
} from './css-bridge.js'

export interface RssItem {
  title: string
  url: string
  published_at: string | null
  excerpt?: string
}

export interface FetchRssResult {
  items: RssItem[]
  notModified: boolean
  etag: string | null
  lastModified: string | null
  contentHash: string | null
  httpCacheSeconds: number | null
  rssTtlSeconds: number | null
}

export class RateLimitError extends Error {
  readonly retryAfterSeconds: number | null
  constructor(status: number, retryAfter: string | null) {
    let seconds: number | null = null
    if (retryAfter) {
      const parsed = parseInt(retryAfter, 10)
      if (!isNaN(parsed)) {
        seconds = parsed
      } else {
        const date = new Date(retryAfter).getTime()
        if (!isNaN(date)) {
          seconds = Math.max(0, Math.floor((date - Date.now()) / 1000))
        }
      }
    }
    super(`HTTP ${status} (rate limited${seconds ? `, retry after ${seconds}s` : ''})`)
    this.retryAfterSeconds = seconds
  }
}

function throwIfRateLimited(res: Response): void {
  if (res.status === 429 || res.status === 503) {
    throw new RateLimitError(res.status, res.headers.get('retry-after'))
  }
}

const RSS_BRIDGE_URL = process.env.RSS_BRIDGE_URL

export async function fetchAndParseRss(feed: Feed, opts?: { skipCache?: boolean }): Promise<FetchRssResult> {
  const skipCache = opts?.skipCache ?? false
  const rssUrl = feed.rss_url || feed.rss_bridge_url
  if (!rssUrl) throw new Error('No RSS URL')

  const isCssBridge = isCssSelectorBridgeUrl(rssUrl)

  let xml: string
  let responseEtag: string | null = null
  let responseLastModified: string | null = null
  let responseHeaders: Headers | null = null

  if (feed.requires_js_challenge) {
    // Site requires JS challenge — go straight to FlareSolverr (no conditional request support)
    const flare = await fetchViaFlareSolverr(rssUrl)
    if (!flare) throw new Error('FlareSolverr failed')
    xml = flare.body
  } else {
    const isRssBridgeUrl = RSS_BRIDGE_URL && rssUrl.startsWith(RSS_BRIDGE_URL)
    if (isRssBridgeUrl) {
      // RSS Bridge internal URL: use plain fetch (no SSRF check needed)
      // Strip title_selector/content_selector — these are used by our own code,
      // not recognized by RSS-Bridge's CssSelectorBridge.
      const bridgeFetchUrl = isCssBridge ? stripCustomBridgeParams(rssUrl) : rssUrl
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
      if (!skipCache && feed.etag) headers['If-None-Match'] = feed.etag
      if (!skipCache && feed.last_modified) headers['If-Modified-Since'] = feed.last_modified

      const res = await fetch(bridgeFetchUrl, {
        headers,
        signal: AbortSignal.timeout(DISCOVERY_TIMEOUT),
      })

      if (res.status === 304) {
        return { items: [], notModified: true, etag: feed.etag, lastModified: feed.last_modified, contentHash: feed.last_content_hash, httpCacheSeconds: null, rssTtlSeconds: null }
      }

      responseEtag = res.headers.get('etag')
      responseLastModified = res.headers.get('last-modified')
      responseHeaders = res.headers

      if (!res.ok) {
        throwIfRateLimited(res)
        if (isCssBridge) {
          const items = cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl))
          return { items, notModified: false, etag: responseEtag, lastModified: responseLastModified, contentHash: null, httpCacheSeconds: null, rssTtlSeconds: null }
        }
        const flare = await fetchViaFlareSolverr(rssUrl)
        if (!flare) throw new Error(`HTTP ${res.status}`)
        xml = flare.body
      } else {
        xml = await res.text()
      }
    } else {
      // External URL: use safeFetch with conditional headers
      const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
      if (!skipCache && feed.etag) headers['If-None-Match'] = feed.etag
      if (!skipCache && feed.last_modified) headers['If-Modified-Since'] = feed.last_modified

      try {
        const res = await safeFetch(rssUrl, {
          headers,
          signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
        })

        if (res.status === 304) {
          return { items: [], notModified: true, etag: feed.etag, lastModified: feed.last_modified, contentHash: feed.last_content_hash, httpCacheSeconds: null, rssTtlSeconds: null }
        }

        responseEtag = res.headers.get('etag')
        responseLastModified = res.headers.get('last-modified')
        responseHeaders = res.headers

        if (!res.ok) {
          throwIfRateLimited(res)
          // Non-200: try FlareSolverr fallback (no conditional request support)
          const flare = await fetchViaFlareSolverr(rssUrl)
          if (!flare) throw new Error(`HTTP ${res.status}`)
          xml = flare.body
        } else {
          xml = await res.text()
        }
      } catch (err) {
        if (isCssBridge) {
          const items = cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl))
          return { items, notModified: false, etag: null, lastModified: null, contentHash: null, httpCacheSeconds: null, rssTtlSeconds: null }
        }
        throw err
      }
    }
  }

  // Content hash check: skip parsing if body is identical to last fetch
  const contentHash = createHash('sha256').update(xml).digest('hex')
  const httpCacheSeconds = responseHeaders ? parseHttpCacheInterval(responseHeaders) : null
  const rssTtlSeconds = parseRssTtl(xml)

  if (!skipCache && feed.last_content_hash && feed.last_content_hash === contentHash) {
    return { items: [], notModified: true, etag: responseEtag, lastModified: responseLastModified, contentHash, httpCacheSeconds, rssTtlSeconds }
  }

  const result = { notModified: false as const, etag: responseEtag, lastModified: responseLastModified, contentHash, httpCacheSeconds, rssTtlSeconds }

  // Parse XML and collect items — wrapped in try/catch for Fallback C
  let items: RssItem[]
  try {
    items = await parseRssXml(xml)
  } catch (err) {
    // Fallback C: CssSelectorBridge parse failure → FlareSolverr direct scrape
    if (isCssBridge) {
      return { ...result, items: cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl)) }
    }
    throw err
  }

  // Fallback B: CssSelectorBridge returned 0 items → FlareSolverr direct scrape
  if (items.length === 0 && isCssBridge) {
    return { ...result, items: cleanItems(assignCssBridgePseudoDates(await fetchCssSelectorViaFlareSolverr(rssUrl), rssUrl)) }
  }

  if (!isCssBridge) return { ...result, items: cleanItems(items) }

  // CssSelectorBridge: fix generic titles + enrich excerpts, then assign pseudo dates
  items = await fixGenericTitlesAndEnrichExcerpts(items, rssUrl)
  return { ...result, items: cleanItems(assignCssBridgePseudoDates(items, rssUrl)) }
}

const RSS_BRIDGE_ERROR_RE = /^Bridge returned error/i

function cleanItems(items: RssItem[]): RssItem[] {
  return items
    .filter(item => !RSS_BRIDGE_ERROR_RE.test(item.title))
    .map(item => ({ ...item, url: cleanUrl(item.url) }))
}

async function parseRssXml(xml: string): Promise<RssItem[]> {
  // Try feedsmith first
  try {
    const { parseFeed } = await import('feedsmith')
    const parsed = parseFeed(xml) as Record<string, unknown>
    const feed = parsed.feed as Record<string, unknown> | undefined
    const items = (parsed.items ?? parsed.entries ?? feed?.items ?? feed?.entries) as Record<string, unknown>[] | undefined
    if (items && items.length > 0) {
      return items
        .filter((item: Record<string, unknown>) => {
          if (item.url || item.link) return true
          // feedsmith puts Atom <link> elements in a links[] array
          const links = item.links as { href?: string; rel?: string }[] | undefined
          if (links?.length) return true
          // Only use id as URL when it looks like an HTTP URL
          const id = item.id as string | undefined
          return id ? /^https?:\/\//i.test(id) : false
        })
        .map((item: Record<string, unknown>) => {
          let url = (item.url || item.link) as string | undefined
          if (!url) {
            // Extract URL from feedsmith links[] array (prefer rel=alternate)
            const links = item.links as { href?: string; rel?: string }[] | undefined
            if (links?.length) {
              const alt = links.find(l => l.rel === 'alternate')
              url = alt?.href || links[0]?.href
            }
          }
          return {
            title: (item.title as string) || 'Untitled',
            url: (url || item.id) as string,
            published_at: normalizeDate(
              (item.published || item.updated || item.date || item.pubDate || (item.dc as Record<string, unknown>)?.date) as string | undefined,
            ),
          }
        })
    }
  } catch {
    // feedsmith failed, fall through to fast-xml-parser
  }

  // Fallback: fast-xml-parser
  const { XMLParser } = await import('fast-xml-parser')
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
  const doc = parser.parse(xml)

  // fast-xml-parser returns { "#text": "...", "@_type": "html" } for elements with attributes
  function textOf(val: unknown): string {
    if (typeof val === 'string') return val
    if (val && typeof val === 'object' && '#text' in val) return String((val as Record<string, unknown>)['#text'])
    return ''
  }

  // RSS 2.0
  const channel = doc?.rss?.channel
  if (channel?.item) {
    const items = Array.isArray(channel.item) ? channel.item : [channel.item]
    return items
      .map((item: Record<string, unknown>) => ({
        title: textOf(item.title) || 'Untitled',
        url: (item.link || item.guid || '') as string,
        published_at: normalizeDate(item.pubDate as string | undefined),
      }))
      .filter((item: RssItem) => item.url)
  }

  // Atom
  const atomFeed = doc?.feed
  if (atomFeed?.entry) {
    const entries = Array.isArray(atomFeed.entry) ? atomFeed.entry : [atomFeed.entry]
    return entries
      .map((entry: Record<string, unknown>) => {
        const link = Array.isArray(entry.link)
          ? (entry.link as Record<string, string>[]).find(l => l['@_rel'] === 'alternate')?.['@_href'] ||
            (entry.link as Record<string, string>[])[0]?.['@_href']
          : (entry.link as Record<string, string>)?.['@_href'] || (entry.link as string)
        const id = entry.id as string | undefined
        const effectiveUrl = link || (id && /^https?:\/\//i.test(id) ? id : '') || ''
        return {
          title: textOf(entry.title) || 'Untitled',
          url: effectiveUrl,
          published_at: normalizeDate(
            (entry.published || entry.updated) as string | undefined,
          ),
        }
      })
      .filter((item: RssItem) => item.url)
  }

  // RSS 1.0 (RDF)
  const rdf = doc?.['rdf:RDF']
  const rdfItem = rdf?.item
  if (rdfItem) {
    const items = Array.isArray(rdfItem) ? rdfItem : [rdfItem]
    return items
      .map((item: Record<string, unknown>) => ({
        title: textOf(item.title) || 'Untitled',
        url: (item.link || item['@_rdf:about'] || '') as string,
        published_at: normalizeDate((item['dc:date'] ?? item.pubDate) as string | undefined),
      }))
      .filter((item: RssItem) => item.url)
  }

  throw new Error('Could not parse RSS/Atom feed')
}

async function fetchFeedTitle(rssUrl: string): Promise<string | null> {
  try {
    const { html: xml } = await fetchHtml(rssUrl, { timeout: DISCOVERY_TIMEOUT })

    // Try feedsmith
    try {
      const { parseFeed } = await import('feedsmith')
      const parsed = parseFeed(xml) as Record<string, unknown>
      const feed = parsed.feed as Record<string, unknown> | undefined
      const title = parsed.title ?? feed?.title
      if (title && typeof title === 'string') return title
    } catch {
      // feedsmith failed, fall through
    }

    // Fallback: fast-xml-parser
    const { XMLParser } = await import('fast-xml-parser')
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })
    const doc = parser.parse(xml)

    const rssTitle = doc?.rss?.channel?.title
    if (rssTitle && typeof rssTitle === 'string') return rssTitle

    const atomTitle = doc?.feed?.title
    if (atomTitle && typeof atomTitle === 'string') return atomTitle

    return null
  } catch {
    return null
  }
}

export interface DiscoverCallbacks {
  onFlareSolverr?: (status: 'running' | 'done', found?: boolean) => void
}

export async function discoverRssUrl(blogUrl: string, callbacks?: DiscoverCallbacks): Promise<{ rssUrl: string | null; title: string | null; usedFlareSolverr: boolean }> {
  let rssUrl: string | null = null
  let pageTitle: string | null = null
  let usedFlareSolverr = false

  // Step 1: Fetch page, check if it's a direct feed, otherwise look for <link rel="alternate">
  try {
    const result = await fetchHtml(blogUrl, { timeout: DISCOVERY_TIMEOUT })
    usedFlareSolverr = result.usedFlareSolverr
    if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('running')

    // If the URL itself is an RSS/Atom feed, return it directly
    const ct = result.contentType
    if (ct.includes('xml') || ct.includes('atom') || ct.includes('rss')) {
      if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('done', true)
      const feedTitle = await fetchFeedTitle(blogUrl)
      return { rssUrl: blogUrl, title: feedTitle, usedFlareSolverr }
    }

    // Otherwise treat as HTML and discover feed links
    const dom = new JSDOM(result.html, { url: blogUrl })
    const doc = dom.window.document

    pageTitle = doc.querySelector('title')?.textContent?.trim() || null

    const links = doc.querySelectorAll(
      'link[rel="alternate"][type="application/rss+xml"], link[rel="alternate"][type="application/atom+xml"]',
    )
    for (const link of links) {
      const href = link.getAttribute('href')
      if (href) {
        rssUrl = new URL(href, blogUrl).toString()
        break
      }
    }

    if (result.usedFlareSolverr) callbacks?.onFlareSolverr?.('done', !!rssUrl)
  } catch {
    // Page fetch failed, continue to path probing
  }

  // Step 2: Probe candidate paths (if Step 1 didn't find RSS)
  if (!rssUrl) {
    const candidates = ['/feed', '/feed.xml', '/rss', '/rss.xml', '/atom.xml', '/index.xml']
    const base = new URL(blogUrl)

    for (const candidatePath of candidates) {
      const candidateUrl = new URL(candidatePath, base).toString()
      try {
        let probeRes = await fetch(candidateUrl, {
          method: 'HEAD',
          headers: { 'User-Agent': USER_AGENT },
          signal: AbortSignal.timeout(PROBE_TIMEOUT),
        })
        if (!probeRes.ok && probeRes.status === 405) {
          probeRes = await fetch(candidateUrl, {
            method: 'GET',
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(PROBE_TIMEOUT),
          })
        }
        if (probeRes.ok) {
          const ct = probeRes.headers.get('content-type') || ''
          if (ct.includes('xml') || ct.includes('atom') || ct.includes('rss')) {
            rssUrl = candidateUrl
            break
          }
        }
      } catch {
        // Probe failed, try next
      }
    }
  }

  if (!rssUrl) return { rssUrl: null, title: pageTitle, usedFlareSolverr }

  // Step 3: Fetch the feed itself to get the canonical feed title
  const feedTitle = await fetchFeedTitle(rssUrl)
  return { rssUrl, title: feedTitle || pageTitle, usedFlareSolverr }
}
