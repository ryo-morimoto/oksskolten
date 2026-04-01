import { useState } from 'react'

export interface Article {
  id: number
  title: string
  url: string
  excerpt: string | null
  og_image: string | null
  feed_name: string | null
  quality_score: number | null
  recommendation_score: number
  published_at: string | null
  seen_at: string | null
  bookmarked_at: string | null
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / (1000 * 60))
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

function qualityLabel(score: number | null): { text: string; color: string } | null {
  if (score == null) return null
  if (score >= 0.7) return { text: 'High', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (score >= 0.4) return { text: 'Mid', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  return null
}

export function ArticleCard({ article, onSelect }: { article: Article; onSelect: (id: number) => void }) {
  const [bookmarked] = useState(!!article.bookmarked_at)
  const [read] = useState(!!article.seen_at)

  const badge = qualityLabel(article.quality_score)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(article.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(article.id) }}
      className={`group flex cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-white transition-shadow hover:shadow-md dark:border-gray-700 dark:bg-gray-800 ${read ? 'opacity-50' : ''}`}
    >
      {/* OG Image */}
      {article.og_image ? (
        <div className="hidden sm:block w-40 shrink-0 overflow-hidden bg-gray-100 dark:bg-gray-700">
          <img
            src={article.og_image}
            alt=""
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="hidden sm:flex w-40 shrink-0 items-center justify-center bg-gray-50 text-3xl text-gray-300 dark:bg-gray-700 dark:text-gray-600">
          {'\u{1F4C4}'}
        </div>
      )}

      {/* Content */}
      <div className="flex min-w-0 flex-1 flex-col justify-between p-4">
        <div>
          {/* Meta row */}
          <div className="mb-1.5 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            {article.feed_name && (
              <span className="font-medium text-gray-700 dark:text-gray-300">{article.feed_name}</span>
            )}
            {article.published_at && <span>{timeAgo(article.published_at)}</span>}
            {badge && (
              <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.color}`}>
                {badge.text}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-sm font-semibold leading-snug text-gray-900 group-hover:text-blue-600 dark:text-gray-100 dark:group-hover:text-blue-400 line-clamp-2">
            {article.title}
          </h3>

          {/* Excerpt */}
          {article.excerpt && (
            <p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400 line-clamp-2">
              {article.excerpt}
            </p>
          )}
        </div>

        {/* Status indicators */}
        <div className="mt-3 flex items-center gap-2">
          {bookmarked && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
              {'\u2605'} Saved
            </span>
          )}
          {read && (
            <span className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500">
              {'\u2713'} Read
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
