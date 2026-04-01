import { useApp } from '@modelcontextprotocol/ext-apps/react'
import { useState } from 'react'
import { ArticleCard, type Article } from './components/ArticleCard'
import { ArticleDetail } from './components/ArticleDetail'

export function App() {
  const [articles, setArticles] = useState<Article[]>([])
  const [total, setTotal] = useState(0)
  const [theme, setTheme] = useState<string>('light')
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null)

  const { app, isConnected, error } = useApp({
    appInfo: { name: 'Oksskolten Articles', version: '0.2.0' },
    capabilities: {},
    onAppCreated: (app) => {
      app.ontoolresult = (result) => {
        if (result.isError) return
        const textItem = result.content?.find(
          (c): c is { type: 'text'; text: string } => c.type === 'text' && 'text' in c,
        )
        if (textItem) {
          try {
            const data = JSON.parse(textItem.text)
            if (data.articles) {
              setArticles(data.articles)
              setTotal(data.total ?? 0)
            }
          } catch { /* not JSON */ }
        }
      }
      app.onhostcontextchanged = (ctx) => {
        if (ctx.theme) setTheme(ctx.theme)
      }
    },
  })

  if (error) return <div className="p-4 text-sm text-red-500">Error: {error.message}</div>
  if (!isConnected) return <div className="p-6 text-sm text-gray-400">Connecting...</div>

  const themeClass = theme === 'dark' ? 'dark' : ''

  // Detail view
  if (selectedArticle != null) {
    return (
      <div className={themeClass}>
        <ArticleDetail
          article={selectedArticle}
          app={app}
          onBack={() => setSelectedArticle(null)}
        />
      </div>
    )
  }

  // List view
  if (articles.length === 0) return <div className="p-6 text-sm text-gray-400">Waiting for articles...</div>

  return (
    <div className={themeClass}>
      <div className="min-h-screen bg-gray-50 p-4 dark:bg-gray-900 sm:p-6">
        <div className="mb-4 text-xs font-medium text-gray-500 dark:text-gray-400">
          {total} articles
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              article={article}
              onSelect={() => setSelectedArticle(article)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
