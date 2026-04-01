import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  private handleRetry = () => {
    this.setState({ error: null })
  }

  private handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-bg text-text p-6">
          <div className="max-w-md w-full text-center space-y-4">
            <div className="text-4xl">!</div>
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            <p className="text-sm text-muted">{this.state.error.message}</p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <button
                onClick={this.handleRetry}
                className="px-4 py-2 text-sm rounded-lg bg-accent text-accent-text hover:opacity-90 transition-opacity"
              >
                Retry
              </button>
              <button
                onClick={this.handleGoHome}
                className="px-4 py-2 text-sm rounded-lg border border-border text-text hover:bg-hover transition-colors"
              >
                Go to Home
              </button>
            </div>
            <details className="text-left mt-4">
              <summary className="text-xs text-muted cursor-pointer hover:text-text transition-colors">
                Stack trace
              </summary>
              <pre className="mt-2 text-[11px] text-muted bg-bg-subtle rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap break-all">
                {this.state.error.stack}
              </pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
