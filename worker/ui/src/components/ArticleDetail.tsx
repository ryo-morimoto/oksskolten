import { type App } from '@modelcontextprotocol/ext-apps'
import { useState, useEffect } from 'react'

interface FullArticle {
  id: number
  title: string
  url: string
  excerpt: string | null
  full_text: string | null
  og_image: string | null
  feed_name: string | null
  quality_score: number | null
  published_at: string | null
  seen_at: string | null
  bookmarked_at: string | null
  liked_at: string | null
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateStr))
}

export function ArticleDetail({ id, app, onBack }: { id: number; app: App | null; onBack: () => void }) {
  const [article, setArticle] = useState<FullArticle | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [bookmarked, setBookmarked] = useState(false)
  const [read, setRead] = useState(false)
  const [acting, setActing] = useState(false)
  const [contextSent, setContextSent] = useState(false)

  useEffect(() => {
    if (!app) return
    setLoading(true)
    setError(null)
    app.callServerTool({ name: 'get_article', arguments: { id } }).then((result) => {
      if (result.isError) {
        setError('Failed to load article')
        return
      }
      const textItem = result.content?.find(
        (c): c is { type: 'text'; text: string } => c.type === 'text' && 'text' in c,
      )
      if (textItem) {
        const data = JSON.parse(textItem.text) as FullArticle
        setArticle(data)
        setBookmarked(!!data.bookmarked_at)
        setRead(!!data.seen_at)
      }
    }).catch(() => {
      setError('Failed to load article')
    }).finally(() => {
      setLoading(false)
    })
  }, [app, id])

  const handleBookmark = async () => {
    if (!app || !article || acting) return
    setActing(true)
    try {
      await app.callServerTool({ name: 'toggle_bookmark', arguments: { id: article.id, bookmarked: !bookmarked } })
      setBookmarked(!bookmarked)
    } finally {
      setActing(false)
    }
  }

  const handleRead = async () => {
    if (!app || !article || acting || read) return
    setActing(true)
    try {
      await app.callServerTool({ name: 'mark_as_read', arguments: { id: article.id } })
      setRead(true)
    } finally {
      setActing(false)
    }
  }

  const handleOpenOriginal = async () => {
    if (!app || !article) return
    await app.openLink({ url: article.url })
  }

  const handleDiscuss = async () => {
    if (!app || !article) return
    const body = article.full_text || article.excerpt || ''
    await app.updateModelContext({
      content: [{
        type: 'text',
        text: `# ${article.title}\n\nSource: ${article.url}\nPublished: ${article.published_at || 'unknown'}\n\n${body}`,
      }],
    })
    setContextSent(true)
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-400">Loading article...</div>
  }
  if (error || !article) {
    return (
      <div className="p-6">
        <button onClick={onBack} className="mb-4 text-sm text-blue-600 hover:underline dark:text-blue-400">{'\u2190'} Back</button>
        <p className="text-sm text-red-500">{error || 'Article not found'}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/80 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-800/80">
        <button onClick={onBack} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
          {'\u2190'} Back
        </button>
      </div>

      {/* Article */}
      <div className="mx-auto max-w-2xl px-4 py-6">
        {/* Meta */}
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {article.feed_name && (
            <span className="font-medium text-gray-700 dark:text-gray-300">{article.feed_name}</span>
          )}
          {article.published_at && <span>{formatDate(article.published_at)}</span>}
        </div>

        {/* Title */}
        <h1 className="text-xl font-bold leading-tight text-gray-900 dark:text-gray-100">
          {article.title}
        </h1>

        {/* OG Image */}
        {article.og_image && (
          <img
            src={article.og_image}
            alt=""
            className="mt-4 w-full rounded-lg object-cover"
            loading="lazy"
          />
        )}

        {/* Body */}
        <div className="mt-6 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap dark:text-gray-300">
          {article.full_text || article.excerpt || 'No content available.'}
        </div>

        {/* Actions */}
        <div className="mt-8 flex flex-wrap items-center gap-2 border-t border-gray-200 pt-4 dark:border-gray-700">
          <button
            onClick={handleOpenOriginal}
            className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            {'\u{1F517}'} Open original
          </button>
          <button
            onClick={handleBookmark}
            disabled={acting}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              bookmarked
                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
          >
            {bookmarked ? '\u2605 Saved' : '\u2606 Save'}
          </button>
          <button
            onClick={handleRead}
            disabled={acting || read}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              read
                ? 'bg-gray-100 text-gray-400 dark:bg-gray-700 dark:text-gray-500'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:hover:bg-gray-600'
            }`}
          >
            {read ? '\u2713 Read' : '\u25CB Mark read'}
          </button>
          <button
            onClick={handleDiscuss}
            disabled={contextSent}
            className={`inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              contextSent
                ? 'bg-blue-100 text-blue-400 dark:bg-blue-900/30 dark:text-blue-500'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:hover:bg-blue-800/40'
            }`}
          >
            {contextSent ? '\u2713 Sent to AI' : '\u{1F4AC} Discuss with AI'}
          </button>
        </div>
      </div>
    </div>
  )
}
