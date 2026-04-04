// Stub: summarize AI endpoint is not available in this deployment.
// Returns null/empty state so ArticleSummarySection renders nothing.

import type { ArticleDetail } from '@/types'

export function useSummarize(
  article: Pick<ArticleDetail, 'id' | 'summary'> | undefined,
  _metrics: unknown,
) {
  return {
    summary: article?.summary ?? null,
    summarizing: false,
    streamingText: '',
    streamingHtml: '',
    summaryHtml: '',
    error: null as string | null,
    handleSummarize: () => {},
  }
}
