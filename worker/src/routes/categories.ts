import { Hono } from 'hono'
import type { AppContext } from '../index'
import { requireScope } from '../auth/bearer'

export const categoryRoutes = new Hono<AppContext>()

categoryRoutes.get('/categories', async (c) => {
  const result = await c.env.DB.prepare(
    'SELECT * FROM categories ORDER BY sort_order ASC, name COLLATE NOCASE ASC',
  ).all()
  return c.json({ categories: result.results })
})

categoryRoutes.post('/categories', requireScope('write'), async (c) => {
  const body = await c.req.json<{ name?: string }>()
  const name = body.name?.trim()
  if (!name) {
    return c.json({ error: 'name is required' }, 400)
  }

  const maxOrder = await c.env.DB.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM categories',
  ).first<{ next: number }>()

  const created = await c.env.DB.prepare(
    'INSERT INTO categories (name, sort_order) VALUES (?, ?) RETURNING *',
  )
    .bind(name, maxOrder!.next)
    .first()

  return c.json(created, 201)
})

categoryRoutes.patch('/categories/:id', requireScope('write'), async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const body = await c.req.json<{
    name?: string
    sort_order?: number
    collapsed?: number
  }>()

  const existing = await c.env.DB.prepare(
    'SELECT * FROM categories WHERE id = ?',
  )
    .bind(id)
    .first()

  if (!existing) return c.json({ error: 'Category not found' }, 404)

  const sets: string[] = []
  const values: unknown[] = []

  if (body.name !== undefined) {
    sets.push('name = ?')
    values.push(body.name)
  }
  if (body.sort_order !== undefined) {
    sets.push('sort_order = ?')
    values.push(body.sort_order)
  }
  if (body.collapsed !== undefined) {
    sets.push('collapsed = ?')
    values.push(body.collapsed)
  }

  if (sets.length === 0) return c.json(existing)

  values.push(id)
  await c.env.DB.prepare(
    `UPDATE categories SET ${sets.join(', ')} WHERE id = ?`,
  )
    .bind(...values)
    .run()

  const updated = await c.env.DB.prepare(
    'SELECT * FROM categories WHERE id = ?',
  )
    .bind(id)
    .first()
  return c.json(updated)
})

categoryRoutes.delete('/categories/:id', requireScope('write'), async (c) => {
  const id = Number(c.req.param('id'))
  if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400)

  const result = await c.env.DB.prepare(
    'DELETE FROM categories WHERE id = ?',
  )
    .bind(id)
    .run()

  if (!result.meta.changes) return c.json({ error: 'Category not found' }, 404)

  return c.body(null, 204)
})
