// Stub: AI metrics are tied to streaming AI which is not available in this deployment.

export interface Metrics {
  time: number
  inputTokens: number
  outputTokens: number
  billingMode?: string
  model?: string
  monthlyChars?: number
}

export function useMetrics() {
  return {
    metrics: null as Metrics | null,
    report: (_m: Metrics) => {},
    reset: () => {},
    formatMetrics: () => null as string | null,
  }
}
