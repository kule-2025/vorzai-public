import React, { Component, ErrorInfo, ReactNode } from 'react';

// ============================================================
// ErrorBoundary — 防止子组件渲染异常导致整个应用白屏
// 捕获后展示友好错误页，提供重试按钮
// ============================================================

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error('[ErrorBoundary]', error, errorInfo.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', padding: 48, minHeight: 240,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none"
            stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            style={{ marginBottom: 16 }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <h2 style={{ fontSize: 18, fontWeight: 600, color: '#1e293b', margin: '0 0 8px' }}>
            页面渲染异常
          </h2>
          <p style={{ fontSize: 14, color: '#64748b', margin: '0 0 4px', textAlign: 'center', maxWidth: 400 }}>
            {this.state.error?.message || '未知错误'}
          </p>
          {this.state.errorInfo && (
            <details style={{ margin: '8px 0', fontSize: 12, color: '#94a3b8', maxWidth: 480 }}>
              <summary style={{ cursor: 'pointer' }}>技术详情</summary>
              <pre style={{
                whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                background: '#f8fafc', padding: 8, borderRadius: 6,
                marginTop: 4, maxHeight: 200, overflow: 'auto',
              }}>
                {this.state.error?.stack?.slice(0, 800)}
                {'\n\nComponent Stack:'}
                {this.state.errorInfo.componentStack?.slice(0, 800)}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleRetry}
            style={{
              marginTop: 16, padding: '8px 24px', borderRadius: 8,
              background: '#3b82f6', color: '#fff', border: 'none',
              fontSize: 14, fontWeight: 500, cursor: 'pointer',
              minWidth: 100, minHeight: 44,
            }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
