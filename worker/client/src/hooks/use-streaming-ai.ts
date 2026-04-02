// Stub: streaming AI endpoints are not available in this deployment.
// Returns inert state that satisfies the hook interface without making API calls.

export interface StreamingAIOptions {
  endpoint: (articleId: number) => string
  onComplete?: (text: string, usage: Record<string, unknown>) => void
  fixUnclosedBold?: boolean
}

export function useStreamingAI(
  _articleId: number | undefined,
  _metrics: unknown,
  _options: StreamingAIOptions,
) {
  return {
    processing: false,
    streamingText: '',
    streamingHtml: '',
    error: null as string | null,
    run: () => Promise.resolve(),
  }
}
