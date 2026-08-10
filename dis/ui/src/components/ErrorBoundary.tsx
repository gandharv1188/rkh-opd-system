import { Component, type ReactNode, type ErrorInfo } from 'react';

export interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly reportEndpoint?: string;
  readonly fallback?: (error: Error) => ReactNode;
}

interface State { error: Error | null }

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    const endpoint = this.props.reportEndpoint ?? '/admin/errors';
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: error.message,
        stack: error.stack,
        componentStack: info.componentStack,
        correlation_id: (window as unknown as { __disCorrelationId?: string }).__disCorrelationId ?? null,
      }),
    }).catch(() => undefined);
  }

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error);
      return (
        <div data-testid="error-boundary-fallback" role="alert">
          <h2>Something went wrong.</h2>
          <p>Please refresh the page. If this keeps happening, contact support.</p>
          <details>
            <summary>Details</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
