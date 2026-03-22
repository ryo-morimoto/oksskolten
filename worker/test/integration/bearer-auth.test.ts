import { describe, it, expect, beforeEach } from 'vitest'
import { exports } from 'cloudflare:workers'
import { setupTestDb, seedApiKey } from '../helpers'

const fetch = (url: string, init?: RequestInit) =>
  exports.default.fetch(new Request(url, init))

describe('Bearer auth', () => {
  beforeEach(async () => {
    await setupTestDb()
  })

  it('returns 401 without Authorization header', async () => {
    const res = await fetch('https://test.host/api/feeds')
    expect(res.status).toBe(401)
  })

  it('returns 401 with invalid key', async () => {
    const res = await fetch('https://test.host/api/feeds', {
      headers: { Authorization: 'Bearer ok_invalid_key' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 401 with non-ok_ prefix', async () => {
    const res = await fetch('https://test.host/api/feeds', {
      headers: { Authorization: 'Bearer some_random_token' },
    })
    expect(res.status).toBe(401)
  })

  it('returns 200 with valid key', async () => {
    const key = await seedApiKey('read,write')
    const res = await fetch('https://test.host/api/feeds', {
      headers: { Authorization: `Bearer ${key}` },
    })
    expect(res.status).toBe(200)
  })

  it('returns 403 when scope is insufficient', async () => {
    const key = await seedApiKey('read')
    const res = await fetch('https://test.host/api/feeds', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    expect(res.status).toBe(403)
  })
})
