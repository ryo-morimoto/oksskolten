import { useState } from 'react'
import { authHeaders } from '@/lib/fetcher'
import { logoutClient } from '@/lib/auth'
import { useI18n } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import type { Category } from '../../../../shared/types'

type TranslateFn = ReturnType<typeof useI18n>['t']

/** Map raw server error messages to i18n keys so they render in the user's locale. */
function localizeServerError(raw: string, t: TranslateFn): string {
  if (raw.includes('RSS could not be detected')) return t('modal.errorRssNotDetected')
  if (raw.includes('already exists')) return t('modal.errorAlreadyExists')
  if (raw.includes('https://')) return t('modal.errorHttpsOnly')
  return raw || t('modal.genericError')
}

interface FeedStepProps {
  onClose: () => void
  onCreated: () => void
  onFetchStarted?: (feedId: number) => void
  categories: Category[]
}

export function FeedStep({ onClose, onCreated, onFetchStarted, categories }: FeedStepProps) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [categoryId, setCategoryId] = useState<number | ''>('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!url.trim()) return
    setError('')
    setLoading(true)

    try {
      const res = await fetch('/api/feeds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          name: name.trim() || undefined,
          url: url.trim(),
          category_id: categoryId || null,
        }),
      })

      if (res.status === 401) {
        logoutClient()
        throw new Error('Unauthorized')
      }

      const contentType = res.headers.get('Content-Type') || ''

      // Non-SSE response (400/409 errors)
      if (!contentType.includes('text/event-stream')) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || res.statusText)
      }

      // SSE response — read until done event
      if (!res.body) throw new Error('Response body is null')
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop()!

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          let payload: Record<string, unknown>
          try {
            payload = JSON.parse(line.slice(6))
          } catch {
            continue
          }

          if (payload.type === 'done') {
            const feed = payload.feed as { id: number; rss_url: string | null; rss_bridge_url: string | null }
            onCreated()
            if (feed.rss_url || feed.rss_bridge_url) {
              onFetchStarted?.(feed.id)
            }
            onClose()
            return
          } else if (payload.type === 'error') {
            throw new Error(payload.error as string || 'Unknown error')
          }
        }
      }

      // If we reach here without a done event, treat as success
      onCreated()
      onClose()
    } catch (err) {
      const raw = err instanceof Error ? err.message : ''
      setError(localizeServerError(raw, t))
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <Input
        type="url"
        placeholder={t('modal.url')}
        value={url}
        onChange={e => setUrl(e.target.value)}
        autoFocus
        required
      />
      <Input
        type="text"
        placeholder={t('modal.namePlaceholder')}
        value={name}
        onChange={e => setName(e.target.value)}
      />
      {categories.length > 0 && (
        <Select value={categoryId === '' ? '__none__' : String(categoryId)} onValueChange={v => setCategoryId(v === '__none__' ? '' : Number(v))}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t('category.uncategorized')}</SelectItem>
            {categories.map(cat => (
              <SelectItem key={cat.id} value={String(cat.id)}>{cat.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {error && <p className="text-xs text-error">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {t('modal.cancel')}
        </Button>
        <Button type="submit" disabled={loading}>
          {loading ? t('modal.adding') : t('modal.add')}
        </Button>
      </div>
    </form>
  )
}
