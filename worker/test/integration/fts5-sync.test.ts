import { env } from 'cloudflare:workers'
import { setupTestDb, seedFeed } from '../helpers'

describe('FTS5 sync triggers', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  async function ftsSearch(query: string) {
    return env.DB.prepare(
      'SELECT rowid FROM articles_fts WHERE articles_fts MATCH ?',
    )
      .bind(query)
      .all<{ rowid: number }>()
  }

  it('syncs FTS on INSERT with tokens', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, title_tokens, full_text_tokens)
       VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        feed.id,
        'テスト記事',
        'https://example.com/1',
        '東京 天気',
        '東京 都 天気 予報',
      )
      .run()

    const results = await ftsSearch('東京')
    expect(results.results.length).toBe(1)
  })

  it('does not find articles without tokens via FTS MATCH', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url) VALUES (?, ?, ?)`,
    )
      .bind(feed.id, 'No tokens article', 'https://example.com/2')
      .run()

    // No tokens → MATCH should find nothing (searching for the title won't work)
    const results = await ftsSearch('tokens')
    expect(results.results.length).toBe(0)
  })

  it('syncs FTS on UPDATE of tokens', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url) VALUES (?, ?, ?)`,
    )
      .bind(feed.id, 'Article', 'https://example.com/3')
      .run()

    // No tokens yet — search should find nothing
    const before = await ftsSearch('プログラミング')
    expect(before.results.length).toBe(0)

    // Update tokens
    await env.DB.prepare(
      `UPDATE articles SET title_tokens = ?, full_text_tokens = ? WHERE url = ?`,
    )
      .bind('プログラミング 言語', 'Rust 言語 高速', 'https://example.com/3')
      .run()

    const after = await ftsSearch('プログラミング')
    expect(after.results.length).toBe(1)
  })

  it('removes from FTS on DELETE', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, title_tokens) VALUES (?, ?, ?, ?)`,
    )
      .bind(feed.id, 'To delete', 'https://example.com/4', '削除 テスト')
      .run()

    const before = await ftsSearch('削除')
    expect(before.results.length).toBe(1)

    await env.DB.prepare(
      `DELETE FROM articles WHERE url = ?`,
    )
      .bind('https://example.com/4')
      .run()

    const after = await ftsSearch('削除')
    expect(after.results.length).toBe(0)
  })

  it('removes from FTS on purge (soft-delete)', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, title_tokens) VALUES (?, ?, ?, ?)`,
    )
      .bind(feed.id, 'To purge', 'https://example.com/5', 'パージ テスト')
      .run()

    const before = await ftsSearch('パージ')
    expect(before.results.length).toBe(1)

    await env.DB.prepare(
      `UPDATE articles SET purged_at = datetime('now') WHERE url = ?`,
    )
      .bind('https://example.com/5')
      .run()

    const after = await ftsSearch('パージ')
    expect(after.results.length).toBe(0)
  })

  it('handles UPDATE replacing existing tokens', async () => {
    const feed = await seedFeed()
    await env.DB.prepare(
      `INSERT INTO articles (feed_id, title, url, title_tokens) VALUES (?, ?, ?, ?)`,
    )
      .bind(feed.id, 'Update test', 'https://example.com/6', '古い トークン')
      .run()

    const oldBefore = await ftsSearch('古い')
    expect(oldBefore.results.length).toBe(1)

    // Update with new tokens
    await env.DB.prepare(
      `UPDATE articles SET title_tokens = ? WHERE url = ?`,
    )
      .bind('新しい トークン', 'https://example.com/6')
      .run()

    const oldAfter = await ftsSearch('古い')
    expect(oldAfter.results.length).toBe(0)

    const newAfter = await ftsSearch('新しい')
    expect(newAfter.results.length).toBe(1)
  })
})
