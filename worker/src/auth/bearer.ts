import { createMiddleware } from 'hono/factory'
import type { Env } from '../index'

/**
 * Bearer token authentication middleware.
 * Validates API keys (ok_*) against SHA-256 hashes in the api_keys table.
 * Sets `apiKeyId` and `scopes` on the context variables.
 */
export const bearerAuth = () =>
  createMiddleware<{ Bindings: Env; Variables: { apiKeyId: number; scopes: string[] } }>(
    async (c, next) => {
      const authHeader = c.req.header('Authorization')
      if (!authHeader?.startsWith('Bearer ')) {
        return c.json({ error: 'Missing or invalid Authorization header' }, 401)
      }

      const key = authHeader.slice(7)
      if (!key.startsWith('ok_')) {
        return c.json({ error: 'Invalid API key format' }, 401)
      }

      const keyBuffer = new TextEncoder().encode(key)
      const hashBuffer = await crypto.subtle.digest('SHA-256', keyBuffer)
      const keyHash = [...new Uint8Array(hashBuffer)]
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')

      const row = await c.env.DB.prepare(
        'SELECT id, scopes FROM api_keys WHERE key_hash = ?',
      )
        .bind(keyHash)
        .first<{ id: number; scopes: string }>()

      if (!row) {
        return c.json({ error: 'Invalid API key' }, 401)
      }

      // Update last_used_at (best-effort, don't block)
      c.executionCtx.waitUntil(
        c.env.DB.prepare(
          "UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?",
        )
          .bind(row.id)
          .run(),
      )

      c.set('apiKeyId', row.id)
      c.set('scopes', row.scopes.split(','))
      await next()
    },
  )

/**
 * Middleware to require a specific scope.
 */
export const requireScope = (scope: string) =>
  createMiddleware<{ Variables: { scopes: string[] } }>(async (c, next) => {
    const scopes = c.get('scopes')
    if (!scopes?.includes(scope)) {
      return c.json({ error: `Insufficient scope: requires '${scope}'` }, 403)
    }
    await next()
  })
