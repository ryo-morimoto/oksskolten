import { useMemo } from 'react'
import useSWR from 'swr'
import { useNavigate } from 'react-router-dom'
import { fetcher } from '@/lib/fetcher'
import { useI18n, isMessageKey } from '@/lib/i18n'
import type { TranslateFn } from '@/lib/i18n'
import type { FeedWithCounts } from '@/types'

const RANDOM_GREETING_COUNT = 5

function getGreeting(t: TranslateFn, name: string): string {
  const hour = new Date().getHours()

  // Narrow greeting windows with name
  if (hour >= 5 && hour < 10) return t('home.greeting.morning').replace('{name}', name)
  if (hour >= 12 && hour < 14) return t('home.greeting.afternoon').replace('{name}', name)
  if (hour >= 17 && hour < 21) return t('home.greeting.evening').replace('{name}', name)

  // Outside greeting windows — rotate hourly (deterministic, no storage needed)
  const epochHour = Math.floor(Date.now() / (1000 * 60 * 60))
  const idx = epochHour % RANDOM_GREETING_COUNT
  const key = `home.greeting.random.${idx}`
  return isMessageKey(key) ? t(key) : ''
}

interface FeedStats {
  totalFeeds: number
  totalUnread: number
  topUnreadFeeds: Array<{ id: number; name: string; unread_count: number }>
}

function useFeedStats(): FeedStats {
  const { data } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)

  return useMemo(() => {
    const feeds = data?.feeds ?? []
    const activeFeeds = feeds.filter(f => !f.disabled && f.type !== 'clip')
    const totalUnread = activeFeeds.reduce((sum, f) => sum + f.unread_count, 0)
    const topUnreadFeeds = [...activeFeeds]
      .filter(f => f.unread_count > 0)
      .sort((a, b) => b.unread_count - a.unread_count)
      .slice(0, 5)
    return {
      totalFeeds: activeFeeds.length,
      totalUnread,
      topUnreadFeeds,
    }
  }, [data])
}

export function HomePage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const { data: profile } = useSWR<{ account_name: string }>('/api/settings/profile', fetcher)
  const stats = useFeedStats()

  // Stable greeting per mount
  const greeting = useMemo(
    () => getGreeting(t, profile?.account_name ?? ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [t, profile?.account_name],
  )

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Greeting */}
      <div className="flex items-center gap-3 mb-8">
        <img src="/icons/favicon-black.png" alt="" className="h-10 w-10 dark:hidden" />
        <img src="/icons/favicon-white.png" alt="" className="h-10 w-10 hidden dark:block" />
        <h1 className="text-2xl font-semibold text-text select-none">
          {greeting}
        </h1>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div
          className="border border-border rounded-xl p-4 cursor-pointer hover:bg-hover transition-colors"
          onClick={() => void navigate('/inbox')}
        >
          <p className="text-3xl font-bold text-accent">{stats.totalUnread}</p>
          <p className="text-sm text-muted mt-1">{t('feeds.inbox')}</p>
        </div>
        <div className="border border-border rounded-xl p-4">
          <p className="text-3xl font-bold text-text">{stats.totalFeeds}</p>
          <p className="text-sm text-muted mt-1">{t('feeds.title')}</p>
        </div>
      </div>

      {/* Top unread feeds */}
      {stats.topUnreadFeeds.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-muted uppercase tracking-wider mb-3">
            {t('feeds.title')}
          </h2>
          <div className="space-y-1">
            {stats.topUnreadFeeds.map(feed => (
              <button
                key={feed.id}
                onClick={() => void navigate(`/feeds/${feed.id}`)}
                className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-hover transition-colors flex items-center justify-between"
              >
                <span className="text-sm text-text truncate">{feed.name}</span>
                <span
                  className="text-[11px] text-accent rounded-full px-1.5 leading-relaxed ml-2 shrink-0"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)' }}
                >
                  {feed.unread_count}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
