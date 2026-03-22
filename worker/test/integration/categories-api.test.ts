import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { setupTestDb, fetchApi } from '../helpers'

const api = (path: string, init?: RequestInit) =>
  fetchApi(`/api${path}`, init)

const jsonApi = (path: string, method: string, body: unknown) =>
  api(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('Category CRUD API', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  describe('GET /api/categories', () => {
    it('returns empty list initially', async () => {
      const res = await api('/categories')
      expect(res.status).toBe(200)
      const body = await res.json<{ categories: unknown[] }>()
      expect(body.categories).toHaveLength(0)
    })
  })

  describe('POST /api/categories', () => {
    it('creates a category with auto sort_order', async () => {
      const res = await jsonApi('/categories', 'POST', { name: 'Tech' })
      expect(res.status).toBe(201)
      const body = await res.json<{ name: string; sort_order: number }>()
      expect(body.name).toBe('Tech')
      expect(body.sort_order).toBe(0)

      // Second category gets sort_order 1
      const res2 = await jsonApi('/categories', 'POST', { name: 'News' })
      const body2 = await res2.json<{ sort_order: number }>()
      expect(body2.sort_order).toBe(1)
    })

    it('returns 400 when name is empty', async () => {
      const res = await jsonApi('/categories', 'POST', { name: '' })
      expect(res.status).toBe(400)
    })

    it('returns 400 when name is missing', async () => {
      const res = await jsonApi('/categories', 'POST', {})
      expect(res.status).toBe(400)
    })
  })

  describe('PATCH /api/categories/:id', () => {
    it('updates category name', async () => {
      const created = await jsonApi('/categories', 'POST', { name: 'Old' })
      const cat = await created.json<{ id: number }>()

      const res = await jsonApi(`/categories/${cat.id}`, 'PATCH', {
        name: 'New',
      })
      expect(res.status).toBe(200)
      const body = await res.json<{ name: string }>()
      expect(body.name).toBe('New')
    })

    it('updates collapsed state', async () => {
      const created = await jsonApi('/categories', 'POST', { name: 'Test' })
      const cat = await created.json<{ id: number }>()

      const res = await jsonApi(`/categories/${cat.id}`, 'PATCH', {
        collapsed: 1,
      })
      const body = await res.json<{ collapsed: number }>()
      expect(body.collapsed).toBe(1)
    })

    it('returns 404 for nonexistent category', async () => {
      const res = await jsonApi('/categories/99999', 'PATCH', { name: 'X' })
      expect(res.status).toBe(404)
    })
  })

  describe('DELETE /api/categories/:id', () => {
    it('deletes a category', async () => {
      const created = await jsonApi('/categories', 'POST', { name: 'ToDelete' })
      const cat = await created.json<{ id: number }>()

      const res = await api(`/categories/${cat.id}`, { method: 'DELETE' })
      expect(res.status).toBe(204)

      const check = await env.DB.prepare(
        'SELECT * FROM categories WHERE id = ?',
      )
        .bind(cat.id)
        .first()
      expect(check).toBeNull()
    })

    it('returns 404 for nonexistent category', async () => {
      const res = await api('/categories/99999', { method: 'DELETE' })
      expect(res.status).toBe(404)
    })
  })
})
