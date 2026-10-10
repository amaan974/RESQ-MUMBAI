import { Component, type ReactNode } from 'react'

// Shows a recoverable error instead of a blank page (e.g. backend restarted mid-demo).
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash" role="alert">
        <h2>Display error</h2>
        <p>{this.state.error.message}</p>
        <p className="muted">The simulation state is held on the backend, so reloading is safe.</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
