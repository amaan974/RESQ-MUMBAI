import { Component, type ReactNode } from 'react'

// Shows a recoverable error instead of a blank page (e.g. backend restarted mid-demo).
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="crash">
        <h3>Display error</h3>
        <p className="small">{this.state.error.message}</p>
        <p className="small muted">The simulation state is held on the backend; reloading is safe.</p>
        <button className="primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    )
  }
}
