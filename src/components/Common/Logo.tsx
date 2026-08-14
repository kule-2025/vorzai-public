/**
 * Vorzai 电商 Agent — 全局 Logo 组件
 *
 * 用途：统一所有页面（登录/注册、Topbar、侧边栏）的 Logo 展示
 * 数据来源：public/logo-simple.svg（琥珀金渐变 V 形 Logo）
 *
 * Props:
 *   - size: 图标尺寸（默认 28）
 *   - text: 品牌文字（默认 "Vorzai"）
 *   - subText: 副标题（可选，如 "电商 Agent"）
 *   - variant: "default" | "compact"（紧凑模式仅显示图标）
 */
import type { ReactNode } from 'react';

interface LogoProps {
  size?: number;
  text?: string;
  subText?: string;
  variant?: 'default' | 'compact';
  className?: string;
  children?: ReactNode;
}

// Logo SVG 路径（取自 public/logo-simple.svg 核心图形）
const LOGO_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><defs><linearGradient id="vzG" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FBBF24"/><stop offset="1" stop-color="#D97706"/></linearGradient></defs><rect width="1024" height="1024" fill="url(#vzG)" rx="224"/><path d="M312 768 L512 296 L712 768" fill="none" stroke="#FFFFFF" stroke-width="168" stroke-linecap="round" stroke-linejoin="round"/></svg>`)}`;

export default function Logo({
  size = 28,
  text = 'Vorzai',
  subText = '',
  variant = 'default',
  className = '',
  children,
}: LogoProps) {
  const showText = variant === 'compact' ? false : true;
  const iconSize = variant === 'compact' ? size : size;

  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: showText ? 10 : 0,
        flexShrink: 0,
      }}
    >
      {/* Logo 图标 */}
      <img
        src={LOGO_SVG}
        alt={`${text} Logo`}
        width={iconSize}
        height={iconSize}
        style={{
          borderRadius: 7,
          display: 'block',
          flexShrink: 0,
        }}
      />

      {/* 品牌文字 */}
      {showText && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span
            style={{
              fontSize: size >= 32 ? 17 : 15,
              fontWeight: 700,
              color: 'var(--text-primary)',
              letterSpacing: 0.3,
              whiteSpace: 'nowrap',
            }}
          >
            {text}
          </span>
          {subText && (
            <span
              style={{
                fontSize: 11,
                color: 'var(--text-muted)',
                fontWeight: 400,
                whiteSpace: 'nowrap',
              }}
            >
              {subText}
            </span>
          )}
        </div>
      )}

      {/* 自定义内容（如业务线标签） */}
      {children}
    </div>
  );
}
