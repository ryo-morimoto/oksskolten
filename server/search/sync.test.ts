import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import { getDb } from '../db/connection.js'

// Mock Meilisearch client
const mockWaitTask = vi.fn().mockResolvedValue({})
const mockUpdateDocuments = vi.fn().mockReturnValue({ waitTask: mockWaitTask })
vi.mock('./client.js', () => ({
  getSearchClient: () => ({
    index: () => ({
      updateDocuments: mockUpdateDocuments,
    }),
  }),
  ARTICLES_INDEX: 'articles',
  ARTICLES_STAGING_INDEX: 'articles_staging',
}))

import { syncAllScoredArticlesToSearch, _setRebuilding } from './sync.js'

function seedFeed(): number {
  return getDb().prepare(
    "INSERT INTO feeds (name, url) VALUES ('Test', 'https://example.com/feed')"
  ).run().lastInsertRowid as number
}

function seedArticle(feedId: number, opts: { url: string; published_at?: string }): number {
  return getDb().prepare(
    'INSERT INTO articles (feed_id, title, url, published_at) VALUES (?, ?, ?, ?)'
  ).run(feedId, 'Test Article', opts.url, opts.published_at ?? new Date().toISOString()).lastInsertRowid as number
}

describe('syncAllScoredArticlesToSearch', () => {
  beforeEach(() => {
    setupTestDb()
    mockUpdateDocuments.mockClear()
    mockWaitTask.mockClear()
    _setRebuilding(false)
  })

  it('syncs articles with engagement to Meilisearch and returns count', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/1' })
    seedArticle(feedId, { url: 'https://example.com/2' })

    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(1)
    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockUpdateDocuments.mock.calls[0][0] as { id: number; score: number }[]
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(id1)
    expect(docs[0].score).toBeGreaterThan(0)
    expect(mockWaitTask).toHaveBeenCalledTimes(1)
  })

  it('returns 0 when no articles qualify', async () => {
    const feedId = seedFeed()
    seedArticle(feedId, { url: 'https://example.com/no-engagement' })

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })

  it('includes articles with score > 0 but no engagement flags', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/residual' })

    getDb().prepare('UPDATE articles SET score = 5.0 WHERE id = ?').run(id1)

    await syncAllScoredArticlesToSearch()

    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockUpdateDocuments.mock.calls[0][0] as { id: number; score: number }[]
    expect(docs).toHaveLength(1)
    expect(docs[0].id).toBe(id1)
  })

  it('syncs multiple qualifying articles in one call', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/a' })
    const id2 = seedArticle(feedId, { url: 'https://example.com/b' })
    const id3 = seedArticle(feedId, { url: 'https://example.com/c' })

    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)
    getDb().prepare("UPDATE articles SET bookmarked_at = datetime('now'), score = 5.0 WHERE id = ?").run(id2)
    getDb().prepare("UPDATE articles SET read_at = datetime('now'), score = 2.0 WHERE id = ?").run(id3)

    await syncAllScoredArticlesToSearch()

    expect(mockUpdateDocuments).toHaveBeenCalledTimes(1)
    const docs = mockUpdateDocuments.mock.calls[0][0] as { id: number; score: number }[]
    expect(docs).toHaveLength(3)
    const ids = docs.map(d => d.id).sort()
    expect(ids).toEqual([id1, id2, id3].sort())
  })

  it('returns 0 and skips sync when index rebuild is in progress', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/rebuilding' })
    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 10.0 WHERE id = ?").run(id1)

    _setRebuilding(true)

    const synced = await syncAllScoredArticlesToSearch()

    expect(synced).toBe(0)
    expect(mockUpdateDocuments).not.toHaveBeenCalled()
  })

  it('sends only id and score fields to Meilisearch', async () => {
    const feedId = seedFeed()
    const id1 = seedArticle(feedId, { url: 'https://example.com/fields' })
    getDb().prepare("UPDATE articles SET liked_at = datetime('now'), score = 7.5 WHERE id = ?").run(id1)

    await syncAllScoredArticlesToSearch()

    const docs = mockUpdateDocuments.mock.calls[0][0] as Record<string, unknown>[]
    expect(Object.keys(docs[0]).sort()).toEqual(['id', 'score'])
  })
})
