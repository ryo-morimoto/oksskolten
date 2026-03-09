import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', fontFamily: 'monospace', fontSize: '14px', color: '#c00', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
          <div>[React error] {this.state.error.message}</div>
          <div style={{ marginTop: '1rem', fontSize: '12px', color: '#888' }}>{this.state.error.stack}</div>
        </div>
      )
    }
    return this.props.children
  }
}
