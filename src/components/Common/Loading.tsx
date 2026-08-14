/**
 * Loading 组件 — 加载态
 *
 * 三种模式：
 * - fullscreen: 全屏遮罩
 * - inline:     行内（替换内容）
 * - spinner:    仅图标（用于按钮内）
 */
import React from 'react';

export interface LoadingProps {
  mode?: 'fullscreen' | 'inline' | 'spinner';
  text?: string;
  size?: number;
}

export const Loading: React.FC<LoadingProps> = ({ mode = 'inline', text = '加载中...', size = 32 }) => {
  const icon = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 50 50"
      role="status"
      aria-label={text}
      style={{ animation: 'loadingSpin 0.9s linear infinite', flexShrink: 0 }}
    >
      <circle cx="25" cy="25" r="20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeOpacity="0.2" />
      <path d="M25 5 a20 20 0 0 1 20 20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );

  if (mode === 'spinner') return icon;

  if (mode === 'fullscreen') {
    return (
      <div
        role="status"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(255,255,255,0.6)',
          backdropFilter: 'blur(2px)',
          zIndex: 8000,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          color: 'var(--text-muted)',
          fontSize: 13,
        }}
      >
        {icon}
        <span>{text}</span>
      </div>
    );
  }

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '24px 16px',
        color: 'var(--text-muted)',
        fontSize: 13,
        minHeight: 80,
      }}
    >
      {icon}
      <span>{text}</span>
    </div>
  );
};

export default Loading;
