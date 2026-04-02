import useSWR from 'swr'
import { fetcher } from '@/lib/fetcher'
import type { Article } from '@/types'

interface ArticleRawPageProps {
  articleUrl: string
}

export function ArticleRawPage({ articleUrl }: ArticleRawPageProps) {
  const { data: article } = useSWR<Pick<Article, 'full_text'>>(
    `/api/articles/by-url?url=${encodeURIComponent(articleUrl)}`,
    fetcher,
  )

  if (!article) return null

  return (
    <pre className="min-h-screen bg-bg text-text p-6 md:p-10 whitespace-pre-wrap break-words font-mono text-sm leading-relaxed m-0">
      {article.full_text || ''}
    </pre>
  )
}
