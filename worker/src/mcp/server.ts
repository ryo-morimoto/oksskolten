import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { Env } from '../index'
import { hybridSearch, extractEmbedding } from '../lib/search'
import { getTriagedArticles, computeFeedInterests } from '../lib/triage'

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean }

function json(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

function error(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/**
 * Create and configure the MCP server with all tools.
 * A new instance is created per request (stateless Workers pattern).
 */
export function createMcpServer(env: Env): McpServer {
  const server = new McpServer({
    name: 'oksskolten',
    version: '0.1.0',
  })

  const db = env.DB

  // ── Read tools ──────────────────────────────────────────────

  server.registerTool('get_feeds', {
    description: 'List all RSS feeds with article counts',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await db
      .prepare(
        `SELECT f.*, c.name AS category_name,
          COALESCE(ac.article_count, 0) AS article_count,
          COALESCE(ac.unread_count, 0) AS unread_count
        FROM feeds f
        LEFT JOIN categories c ON f.category_id = c.id
        LEFT JOIN (
          SELECT feed_id,
            COUNT(*) AS article_count,
            SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END) AS unread_count
          FROM active_articles GROUP BY feed_id
        ) ac ON f.id = ac.feed_id
        ORDER BY f.name COLLATE NOCASE`,
      )
      .all()
    return json(result.results)
  })

  server.registerTool('get_categories', {
    description: 'List all categories',
    annotations: { readOnlyHint: true },
  }, async () => {
    const result = await db
      .prepare('SELECT * FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC')
      .all()
    return json(result.results)
  })

  server.registerTool('get_article', {
    description: 'Get a single article by ID with full content',
    inputSchema: { id: z.number().describe('Article ID') },
    annotations: { readOnlyHint: true },
  }, async ({ id }) => {
    const article = await db
      .prepare(
        `SELECT a.*, f.name as feed_name
         FROM active_articles a
         LEFT JOIN feeds f ON a.feed_id = f.id
         WHERE a.id = ?`,
      )
      .bind(id)
      .first()
    if (!article) return error('Article not found')
    return json(article)
  })

  server.registerTool('list_articles', {
    description: 'List articles with filtering and pagination',
    inputSchema: {
      feed_id: z.number().optional().describe('Filter by feed ID'),
      category_id: z.number().optional().describe('Filter by category ID'),
      unread: z.boolean().optional().describe('Only unread articles'),
      bookmarked: z.boolean().optional().describe('Only bookmarked articles'),
      liked: z.boolean().optional().describe('Only liked articles'),
      sort: z.enum(['published_at', 'score']).optional().describe('Sort order (default: published_at)'),
      limit: z.number().min(1).max(100).optional().describe('Number of results (default: 20)'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
    },
    annotations: { readOnlyHint: true },
  }, async (params) => {
    const limit = params.limit ?? 20
    const offset = params.offset ?? 0
    const sort = params.sort ?? 'published_at'

    const conditions: string[] = []
    const binds: unknown[] = []

    if (params.feed_id != null) { conditions.push('a.feed_id = ?'); binds.push(params.feed_id) }
    if (params.category_id != null) { conditions.push('a.category_id = ?'); binds.push(params.category_id) }
    if (params.unread) conditions.push('a.seen_at IS NULL')
    if (params.bookmarked) conditions.push('a.bookmarked_at IS NOT NULL')
    if (params.liked) conditions.push('a.liked_at IS NOT NULL')

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const orderBy = sort === 'score' ? 'a.score DESC' : 'COALESCE(a.published_at, a.fetched_at) DESC'

    const countResult = await db
      .prepare(`SELECT COUNT(*) as total FROM active_articles a ${where}`)
      .bind(...binds)
      .first<{ total: number }>()

    const result = await db
      .prepare(
        `SELECT a.id, a.feed_id, a.category_id, a.title, a.url, a.lang,
                a.excerpt, a.score, a.seen_at, a.read_at,
                a.bookmarked_at, a.liked_at, a.published_at, a.fetched_at,
                f.name as feed_name
         FROM active_articles a
         LEFT JOIN feeds f ON a.feed_id = f.id
         ${where}
         ORDER BY ${orderBy}
         LIMIT ? OFFSET ?`,
      )
      .bind(...binds, limit, offset)
      .all()

    const total = countResult?.total ?? 0
    return json({ articles: result.results, total, has_more: offset + result.results.length < total })
  })

  server.registerTool('get_reading_stats', {
    description: 'Get reading statistics: total articles, read/unread/bookmarked/liked counts',
    annotations: { readOnlyHint: true },
  }, async () => {
    const stats = await db
      .prepare(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN seen_at IS NOT NULL THEN 1 ELSE 0 END) AS seen,
          SUM(CASE WHEN read_at IS NOT NULL THEN 1 ELSE 0 END) AS read,
          SUM(CASE WHEN seen_at IS NULL THEN 1 ELSE 0 END) AS unread,
          SUM(CASE WHEN bookmarked_at IS NOT NULL THEN 1 ELSE 0 END) AS bookmarked,
          SUM(CASE WHEN liked_at IS NOT NULL THEN 1 ELSE 0 END) AS liked
        FROM active_articles`,
      )
      .first()
    return json(stats)
  })

  server.registerTool('get_recent_activity', {
    description: 'Get recently read, bookmarked, or liked articles',
    inputSchema: {
      type: z.enum(['read', 'bookmarked', 'liked']).describe('Activity type'),
      limit: z.number().min(1).max(50).optional().describe('Number of results (default: 10)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ type, limit }) => {
    const n = limit ?? 10
    const col = type === 'read' ? 'read_at' : type === 'bookmarked' ? 'bookmarked_at' : 'liked_at'
    const result = await db
      .prepare(
        `SELECT a.id, a.title, a.url, a.feed_id, f.name as feed_name, a.${col}
         FROM active_articles a
         LEFT JOIN feeds f ON a.feed_id = f.id
         WHERE a.${col} IS NOT NULL
         ORDER BY a.${col} DESC
         LIMIT ?`,
      )
      .bind(n)
      .all()
    return json(result.results)
  })

  server.registerTool('get_user_preferences', {
    description: 'Infer user preferences from engagement data: top feeds, categories, and reading patterns',
    annotations: { readOnlyHint: true },
  }, async () => {
    const topFeeds = await db
      .prepare(
        `SELECT f.id, f.name, COUNT(*) as engagement_count
         FROM active_articles a
         JOIN feeds f ON a.feed_id = f.id
         WHERE a.read_at IS NOT NULL OR a.bookmarked_at IS NOT NULL OR a.liked_at IS NOT NULL
         GROUP BY f.id
         ORDER BY engagement_count DESC
         LIMIT 10`,
      )
      .all()

    const topCategories = await db
      .prepare(
        `SELECT c.id, c.name, COUNT(*) as engagement_count
         FROM active_articles a
         JOIN categories c ON a.category_id = c.id
         WHERE a.read_at IS NOT NULL OR a.bookmarked_at IS NOT NULL OR a.liked_at IS NOT NULL
         GROUP BY c.id
         ORDER BY engagement_count DESC
         LIMIT 10`,
      )
      .all()

    return json({ top_feeds: topFeeds.results, top_categories: topCategories.results })
  })

  // ── Write tools ─────────────────────────────────────────────

  server.registerTool('add_feed', {
    description: 'Add a new RSS feed. Returns the created feed or an error if the URL already exists.',
    inputSchema: {
      url: z.string().url().describe('Feed site URL (e.g. https://example.com)'),
      name: z.string().optional().describe('Display name (defaults to hostname)'),
      rss_url: z.string().url().optional().describe('RSS/Atom feed URL if different from site URL'),
      category_id: z.number().optional().describe('Category ID to assign'),
    },
    annotations: { readOnlyHint: false },
  }, async ({ url, name, rss_url, category_id }) => {
    const existing = await db
      .prepare('SELECT id FROM feeds WHERE url = ?')
      .bind(url)
      .first()
    if (existing) return error('Feed URL already exists')

    const feedName = name || new URL(url).hostname
    const feed = await db
      .prepare(
        'INSERT INTO feeds (name, url, rss_url, category_id) VALUES (?, ?, ?, ?) RETURNING *',
      )
      .bind(feedName, url, rss_url ?? null, category_id ?? null)
      .first()
    return json(feed)
  })

  server.registerTool('mark_as_read', {
    description: 'Mark an article as read',
    inputSchema: { id: z.number().describe('Article ID') },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ id }) => {
    const result = await db
      .prepare(
        `UPDATE articles SET read_at = datetime('now'), seen_at = COALESCE(seen_at, datetime('now'))
         WHERE id = ? AND purged_at IS NULL RETURNING id, read_at, seen_at`,
      )
      .bind(id)
      .first()
    if (!result) return error('Article not found')
    return json(result)
  })

  server.registerTool('toggle_bookmark', {
    description: 'Toggle bookmark on an article',
    inputSchema: {
      id: z.number().describe('Article ID'),
      bookmarked: z.boolean().describe('true to bookmark, false to unbookmark'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ id, bookmarked }) => {
    const val = bookmarked ? "datetime('now')" : 'NULL'
    const result = await db
      .prepare(
        `UPDATE articles SET bookmarked_at = ${val} WHERE id = ? AND purged_at IS NULL RETURNING id, bookmarked_at`,
      )
      .bind(id)
      .first()
    if (!result) return error('Article not found')
    return json(result)
  })

  server.registerTool('toggle_like', {
    description: 'Toggle like on an article',
    inputSchema: {
      id: z.number().describe('Article ID'),
      liked: z.boolean().describe('true to like, false to unlike'),
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
  }, async ({ id, liked }) => {
    const val = liked ? "datetime('now')" : 'NULL'
    const result = await db
      .prepare(
        `UPDATE articles SET liked_at = ${val} WHERE id = ? AND purged_at IS NULL RETURNING id, liked_at`,
      )
      .bind(id)
      .first()
    if (!result) return error('Article not found')
    return json(result)
  })

  // ── Search tools ────────────────────────────────────────────

  server.registerTool('search_articles', {
    description: 'Search articles using hybrid FTS5 + semantic search with trigram correction',
    inputSchema: {
      query: z.string().min(2).describe('Search query (at least 2 characters)'),
      limit: z.number().min(1).max(100).optional().describe('Number of results (default: 20)'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ query, limit, offset }) => {
    const result = await hybridSearch(env, query, limit ?? 20, offset ?? 0)
    return json(result)
  })

  server.registerTool('get_similar_articles', {
    description: 'Find semantically similar articles using vector embeddings',
    inputSchema: {
      id: z.number().describe('Article ID to find similar articles for'),
      limit: z.number().min(1).max(20).optional().describe('Number of results (default: 5)'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ id, limit }) => {
    const n = limit ?? 5

    const article = await db
      .prepare('SELECT title, excerpt FROM active_articles WHERE id = ?')
      .bind(id)
      .first<{ title: string; excerpt: string | null }>()

    if (!article) return error('Article not found')

    const textForEmbedding = [article.title, article.excerpt ?? ''].join(' ').trim()

    let embedding: number[]
    try {
      const er = await env.AI.run('@cf/baai/bge-m3', { text: [textForEmbedding] })
      embedding = extractEmbedding(er)
    } catch {
      return error('AI service unavailable for similarity search')
    }

    const vecResult = await env.VECTORIZE.query(embedding, { topK: n + 1 })
    const matches = (vecResult.matches ?? []).filter((m) => Number(m.id) !== id).slice(0, n)

    if (matches.length === 0) return json({ similar: [] })

    const matchIds = matches.map((m) => Number(m.id))
    const placeholders = matchIds.map(() => '?').join(',')
    const result = await db
      .prepare(
        `SELECT id, title, url, excerpt, feed_id, published_at
         FROM active_articles WHERE id IN (${placeholders})`,
      )
      .bind(...matchIds)
      .all()

    const rowById = new Map(result.results.map((r: Record<string, unknown>) => [r.id as number, r]))
    const similar = matches
      .map((m) => {
        const row = rowById.get(Number(m.id))
        return row ? { ...row, similarity: m.score } : null
      })
      .filter(Boolean)

    return json({ similar })
  })

  // ── Triage tools ──────────────────────────────────────────

  server.registerTool('get_triage', {
    description: 'Get triaged articles ranked by structural quality, feed interest, and recency. Returns the best articles to read right now.',
    inputSchema: {
      feed_id: z.number().optional().describe('Filter to a specific feed'),
      category_id: z.number().optional().describe('Filter to a specific category'),
      min_quality: z.number().min(0).max(1).optional().describe('Minimum quality score (0-1)'),
      unread_only: z.boolean().optional().describe('Only unread articles (default: true)'),
      limit: z.number().min(1).max(50).optional().describe('Number of results (default: 10)'),
      offset: z.number().min(0).optional().describe('Pagination offset'),
    },
    annotations: { readOnlyHint: true },
  }, async (params) => {
    const result = await getTriagedArticles(db, {
      feed_id: params.feed_id,
      category_id: params.category_id,
      min_quality: params.min_quality,
      unread_only: params.unread_only,
      limit: params.limit ?? 10,
      offset: params.offset ?? 0,
    })
    return json(result)
  })

  server.registerTool('get_feed_insights', {
    description: 'Get per-feed interest scores and quality distribution. Shows which feeds produce high-quality content the user engages with.',
    annotations: { readOnlyHint: true },
  }, async () => {
    const interests = await computeFeedInterests(db)
    const qualityStats = await db
      .prepare(
        `SELECT feed_id,
                AVG(quality_score) AS avg_quality,
                COUNT(CASE WHEN quality_score >= 0.6 THEN 1 END) AS high_quality_count,
                COUNT(*) AS total
         FROM active_articles
         WHERE quality_score IS NOT NULL
         GROUP BY feed_id`,
      )
      .all()

    return json({ feeds: interests, quality_stats: qualityStats.results })
  })

  return server
}
