"use client";

import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="min-h-screen flex flex-col items-center justify-center p-6 font-mono"
          style={{ background: "var(--t-bg)", color: "var(--t-text)" }}
        >
          <div className="text-center max-w-sm space-y-4">
            <div className="text-2xl mb-2">⚠</div>
            <h1 className="text-lg font-bold">Something went wrong</h1>
            <p className="text-sm opacity-70">
              The app encountered an unexpected error.
            </p>
            {this.state.error && (
              <pre
                className="text-[10px] p-3 rounded overflow-auto max-h-32 text-left"
                style={{ background: "var(--t-card)", border: "1px solid var(--t-border)" }}
              >
                {this.state.error.message}
              </pre>
            )}
            <button
              onClick={this.handleReset}
              className="px-4 py-2 rounded text-sm font-medium transition-transform active:scale-95"
              style={{
                background: "var(--t-accent)",
                color: "var(--t-bg)",
              }}
            >
              Try Again
            </button>
            <button
              onClick={() => window.location.reload()}
              className="block mx-auto text-xs underline opacity-60 hover:opacity-100"
            >
              Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
