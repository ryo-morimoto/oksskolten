import { Hono } from 'hono'
import type { AppContext } from '../index'
import { findTrigramCandidates } from '../pipeline/article-workflow'

export const searchRoutes = new Hono<AppContext>()

/**
 * Sanitize query for FTS5 MATCH: escape special syntax.
 * FTS5 special chars: AND, OR, NOT, *, ^, (, ), ", NEAR
 */
function sanitizeFts5Query(query: string): string {
  return (
    query
      // Remove FTS5 operators
      .replace(/\b(AND|OR|NOT|NEAR)\b/gi, '')
      // Remove special chars
      .replace(/[*^()"{}[\]]/g, '')
      // Collapse whitespace
      .replace(/\s+/g, ' ')
      .trim()
  )
}

// GET /api/articles/search?q=...&limit=20&offset=0
searchRoutes.get('/articles/search', async (c) => {
  const query = c.req.query('q')
  const limit = Math.min(parseInt(c.req.query('limit') ?? '20', 10), 100)
  const offset = parseInt(c.req.query('offset') ?? '0', 10)

  if (!query || query.trim().length === 0) {
    return c.json({ error: 'q parameter is required' }, 400)
  }

  if (query.trim().length < 2) {
    return c.json({ error: 'query must be at least 2 characters' }, 400)
  }

  const db = c.env.DB
  const sanitized = sanitizeFts5Query(query)

  if (!sanitized) {
    return c.json({ articles: [], total: 0, corrections: [] })
  }

  // Step 1: Try direct FTS5 MATCH with the sanitized query
  let matchQuery = sanitized
  const corrections: string[] = []

  // Step 2: Check term_dictionary for exact match
  const exactMatch = await db
    .prepare('SELECT term FROM term_dictionary WHERE term = ?')
    .bind(sanitized)
    .first<{ term: string }>()

  if (!exactMatch) {
    // Step 3: Try trigram correction
    const candidates = await findTrigramCandidates(db, sanitized, 3)
    if (candidates.length > 0) {
      corrections.push(...candidates)
      // Use original + corrections for FTS5
      matchQuery = [sanitized, ...candidates].join(' OR ')
    }
  }

  // Step 4: FTS5 MATCH + active_articles JOIN
  try {
    const result = await db
      .prepare(
        `SELECT a.id, a.title, a.url, a.excerpt, a.feed_id, a.published_at,
                a.seen_at, a.bookmarked_at, a.liked_at, a.score,
                rank
         FROM articles_fts fts
         JOIN active_articles a ON a.id = fts.rowid
         WHERE articles_fts MATCH ?
         ORDER BY rank
         LIMIT ? OFFSET ?`,
      )
      .bind(matchQuery, limit, offset)
      .all<{
        id: number
        title: string
        url: string
        excerpt: string | null
        feed_id: number
        published_at: string | null
        seen_at: string | null
        bookmarked_at: string | null
        liked_at: string | null
        score: number
        rank: number
      }>()

    // Get total count
    const countResult = await db
      .prepare(
        `SELECT COUNT(*) as total
         FROM articles_fts fts
         JOIN active_articles a ON a.id = fts.rowid
         WHERE articles_fts MATCH ?`,
      )
      .bind(matchQuery)
      .first<{ total: number }>()

    return c.json({
      articles: result.results,
      total: countResult?.total ?? 0,
      corrections,
    })
  } catch (err) {
    // FTS5 MATCH syntax error — return empty results
    console.error('FTS5 search error:', err)
    return c.json({ articles: [], total: 0, corrections: [] })
  }
})
