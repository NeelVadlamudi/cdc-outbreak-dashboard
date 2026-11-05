import { Component } from "react";

/**
 * Named failure surface so a chart/page throw does not blank the whole shell.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("UI error boundary:", error, info?.componentStack);
  }

  render() {
    if (this.state.error) {
      const message =
        this.state.error instanceof Error
          ? this.state.error.message
          : String(this.state.error || "Unknown error");
      return (
        <div className="card fade-in" role="alert" style={{ margin: 16 }}>
          <strong>This view failed to render</strong>
          <p className="page-disclaimer" style={{ marginTop: 8 }}>
            A client-side error stopped this panel. Other routes should still work.
            This is a UI fault—not a disease alert.
          </p>
          <p className="page-disclaimer" style={{ marginTop: 4 }}>
            <code>{message}</code>
          </p>
          <button
            type="button"
            className="retry-btn"
            style={{ marginTop: 12 }}
            onClick={() => this.setState({ error: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
