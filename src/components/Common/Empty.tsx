/**
 * Empty 组件 — 空状态占位
 *
 * 鼓励使用场景：列表为空、搜索无结果、首次引导
 */
import React from 'react';

export interface EmptyProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const DEFAULT_ICON = (
  <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
    <line x1="12" y1="22.08" x2="12" y2="12" />
  </svg>
);

export const Empty: React.FC<EmptyProps> = ({
  title = '暂无数据',
  description,
  icon,
  action,
  size = 'md',
}) => {
  const padding = size === 'sm' ? '16px 8px' : size === 'lg' ? '48px 16px' : '32px 16px';
  const iconSize = size === 'sm' ? 36 : size === 'lg' ? 72 : 56;

  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding,
        gap: 10,
        color: 'var(--text-muted)',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          color: 'var(--text-muted)',
          opacity: 0.6,
          width: iconSize,
          height: iconSize,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
        aria-hidden
      >
        {icon ?? DEFAULT_ICON}
      </div>
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)' }}>{title}</div>
      {description && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 360, lineHeight: 1.6 }}>
          {description}
        </div>
      )}
      {action && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
};

export default Empty;
