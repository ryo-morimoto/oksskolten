// Stub: translate AI endpoint is not available in this deployment.
// Returns null/empty state so ArticleTranslationBanner renders nothing.

import type { ArticleDetail } from '@/types'

type ViewMode = 'translated' | 'original'

export function useTranslate(
  article: Pick<ArticleDetail, 'id' | 'full_text_translated'> | undefined,
  _metrics: unknown,
) {
  return {
    viewMode: 'original' as ViewMode,
    setViewMode: (_mode: ViewMode) => {},
    translating: false,
    translatingText: '',
    translatingHtml: '',
    fullTextTranslated: article?.full_text_translated ?? null,
    error: null as string | null,
    handleTranslate: () => {},
  }
}
