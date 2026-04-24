// Root-level React error boundary. Forwards caught errors to the
// structured log store (source: 'boundary') and shows a minimal
// recovery UI so a rendering crash doesn't leave the user staring at a
// blank screen.
//
// Scope: wraps the top-level `<App />` mount in `src/main.tsx`. The
// artifact-overlay has its own boundary inside App.tsx that captures
// workbench-specific errors (see `OverlayErrorBoundary`).

import React from 'react'
import { log } from '../../lib/logger'

interface Props {
  children: React.ReactNode
}

interface State {
  error: Error | null
}

export default class AppErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    log.exception(error, {
      source: 'boundary',
      type: 'runtime',
      detail: { componentStack: info.componentStack ?? undefined },
    })
  }

  private handleReset = (): void => {
    this.setState({ error: null })
  }

  private handleReload = (): void => {
    window.location.reload()
  }

  render(): React.ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="app-error-boundary">
        <div className="app-error-boundary-panel">
          <h2 className="app-error-boundary-title">Something went wrong</h2>
          <p className="app-error-boundary-message">{error.message}</p>
          {error.stack && (
            <pre className="app-error-boundary-stack">{error.stack}</pre>
          )}
          <div className="app-error-boundary-actions">
            <button
              type="button"
              onClick={this.handleReset}
              className="app-error-boundary-btn"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="app-error-boundary-btn app-error-boundary-btn--primary"
            >
              Reload
            </button>
          </div>
          <p className="app-error-boundary-hint">
            The error has been added to the log console — open it from the
            status bar to see the stack trace and copy it into a bug report.
          </p>
        </div>
      </div>
    )
  }
}
