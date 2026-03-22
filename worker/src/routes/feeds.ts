import { Hono } from 'hono'
import type { AppContext } from '../index'
import { requireScope } from '../auth/bearer'

export const feedRoutes = new Hono<AppContext>()

feedRoutes.get('/feeds', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT f.*, c.name AS category_name,
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
    ORDER BY f.name COLLATE NOCASE
  `).all()

  return c.json({ feeds: result.results })
})

feedRoutes.get('/feeds/:id', async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const feed = await c.env.DB.prepare('SELECT * FROM feeds WHERE id = ?')
    .bind(id)
    .first()
  if (!feed) return c.json({ error: 'Feed not found' }, 404)
  return c.json(feed)
})

feedRoutes.post('/feeds', requireScope('write'), async (c) => {
  const body = await c.req.json<{
    url: string
    name?: string
    rss_url?: string
    category_id?: number | null
  }>()

  if (!body.url) {
    return c.json({ error: 'url is required' }, 400)
  }

  // Check duplicate
  const existing = await c.env.DB.prepare(
    'SELECT id FROM feeds WHERE url = ?',
  )
    .bind(body.url)
    .first()
  if (existing) {
    return c.json({ error: 'Feed URL already exists' }, 409)
  }

  const feedName = body.name || new URL(body.url).hostname
  const feed = await c.env.DB.prepare(
    `INSERT INTO feeds (name, url, rss_url, category_id)
     VALUES (?, ?, ?, ?) RETURNING *`,
  )
    .bind(feedName, body.url, body.rss_url ?? null, body.category_id ?? null)
    .first()

  return c.json(feed, 201)
})

feedRoutes.patch('/feeds/:id', requireScope('write'), async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const body = await c.req.json<{
    name?: string
    disabled?: number
    category_id?: number | null
  }>()

  const existing = await c.env.DB.prepare('SELECT * FROM feeds WHERE id = ?')
    .bind(id)
    .first()
  if (!existing) return c.json({ error: 'Feed not found' }, 404)

  const sets: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) {
    sets.push('name = ?')
    values.push(body.name)
  }
  if (body.disabled !== undefined) {
    sets.push('disabled = ?')
    values.push(body.disabled)
    if (body.disabled === 0) {
      sets.push('error_count = 0', 'last_error = NULL')
    }
  }
  if (body.category_id !== undefined) {
    sets.push('category_id = ?')
    values.push(body.category_id)
  }

  if (sets.length === 0) return c.json(existing)

  values.push(id)

  const stmts = [
    c.env.DB.prepare(
      `UPDATE feeds SET ${sets.join(', ')} WHERE id = ?`,
    ).bind(...values),
  ]

  // Cascade category_id to articles
  if (body.category_id !== undefined) {
    stmts.push(
      c.env.DB.prepare(
        'UPDATE articles SET category_id = ? WHERE feed_id = ?',
      ).bind(body.category_id, id),
    )
  }

  await c.env.DB.batch(stmts)

  const updated = await c.env.DB.prepare('SELECT * FROM feeds WHERE id = ?')
    .bind(id)
    .first()
  return c.json(updated)
})

feedRoutes.delete('/feeds/:id', requireScope('write'), async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const feed = await c.env.DB.prepare('SELECT * FROM feeds WHERE id = ?')
    .bind(id)
    .first<{ type: string }>()
  if (!feed) return c.json({ error: 'Feed not found' }, 404)
  if (feed.type === 'clip') {
    return c.json({ error: 'Cannot delete the clip feed' }, 403)
  }

  await c.env.DB.prepare('DELETE FROM feeds WHERE id = ?').bind(id).run()
  return c.body(null, 204)
})
