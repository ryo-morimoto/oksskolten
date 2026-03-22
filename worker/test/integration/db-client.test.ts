import { describe, it, expect, beforeEach } from 'vitest'
import { env } from 'cloudflare:workers'
import { setupTestDb } from '../helpers'
import { bindNamedParams, runNamed, getNamed, allNamed } from '../../src/db/client'

describe('D1 client helpers', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  describe('bindNamedParams', () => {
    it('replaces @param with positional ?', () => {
      const result = bindNamedParams(
        'SELECT * FROM feeds WHERE id = @id AND type = @type',
        { id: 1, type: 'rss' },
      )
      expect(result.sql).toBe('SELECT * FROM feeds WHERE id = ? AND type = ?')
      expect(result.args).toEqual([1, 'rss'])
    })

    it('handles multiple occurrences of same param', () => {
      const result = bindNamedParams(
        'SELECT * FROM articles WHERE feed_id = @id OR category_id = @id',
        { id: 5 },
      )
      expect(result.sql).toBe(
        'SELECT * FROM articles WHERE feed_id = ? OR category_id = ?',
      )
      expect(result.args).toEqual([5, 5])
    })

    it('throws on missing param', () => {
      expect(() =>
        bindNamedParams('SELECT * FROM feeds WHERE id = @id', {}),
      ).toThrow('Missing SQL parameter: id')
    })

    it('handles empty params with no placeholders', () => {
      const result = bindNamedParams('SELECT 1', {})
      expect(result.sql).toBe('SELECT 1')
      expect(result.args).toEqual([])
    })
  })

  describe('runNamed', () => {
    it('executes INSERT with named params', async () => {
      const result = await runNamed(
        env.DB,
        "INSERT INTO categories (name, sort_order) VALUES (@name, @order)",
        { name: 'Tech', order: 1 },
      )
      expect(result.success).toBe(true)
    })
  })

  describe('getNamed', () => {
    it('returns a single row', async () => {
      await env.DB.prepare(
        "INSERT INTO categories (name) VALUES ('Tech')",
      ).run()

      const row = await getNamed<{ id: number; name: string }>(
        env.DB,
        'SELECT * FROM categories WHERE name = @name',
        { name: 'Tech' },
      )
      expect(row).not.toBeNull()
      expect(row!.name).toBe('Tech')
    })

    it('returns null for no match', async () => {
      const row = await getNamed(
        env.DB,
        'SELECT * FROM categories WHERE name = @name',
        { name: 'nonexistent' },
      )
      expect(row).toBeNull()
    })
  })

  describe('allNamed', () => {
    it('returns all matching rows', async () => {
      await env.DB.batch([
        env.DB.prepare("INSERT INTO categories (name) VALUES ('A')"),
        env.DB.prepare("INSERT INTO categories (name) VALUES ('B')"),
        env.DB.prepare("INSERT INTO categories (name) VALUES ('C')"),
      ])

      const rows = await allNamed<{ name: string }>(
        env.DB,
        'SELECT name FROM categories WHERE sort_order = @order ORDER BY name',
        { order: 0 },
      )
      expect(rows).toHaveLength(3)
      expect(rows.map((r) => r.name)).toEqual(['A', 'B', 'C'])
    })
  })
})
