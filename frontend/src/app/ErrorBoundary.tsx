import { Component, type ErrorInfo, type ReactNode } from 'react'

import { ErrorState } from '@/components/ui/feedback'

interface State {
  error: Error | null
}

/** Catches render errors so one broken view never blanks the whole application. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="This view failed to render"
          error={this.state.error}
          onRetry={() => this.setState({ error: null })}
          className="mt-8"
        />
      )
    }
    return this.props.children
  }
}
