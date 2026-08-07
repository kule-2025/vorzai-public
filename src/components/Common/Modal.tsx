/**
 * Modal 组件 — 全局居中遮罩弹窗
 *
 * 特性：
 * - ESC 关闭
 * - 遮罩点击关闭（可禁用）
 * - 进入/退出动画（CSS keyframe）
 * - 锁定 body 滚动
 * - 焦点管理：自动聚焦首 focusable 元素 / 焦点陷阱
 * - 无障碍：aria-modal / aria-labelledby / aria-describedby
 * - 深浅色适配（CSS 变量）
 */
import React, { useEffect, useRef, useCallback, useMemo } from 'react';

export interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  width?: number | string;
  onClose?: () => void;
  closeOnOverlay?: boolean;
  closeOnEsc?: boolean;
  zIndex?: number;
  /** 标题区下方内容描述，用于 aria-describedby */
  description?: React.ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export const Modal: React.FC<ModalProps> = ({
  open,
  title,
  children,
  footer,
  width = 480,
  onClose,
  closeOnOverlay = true,
  closeOnEsc = true,
  zIndex = 9000,
  description,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  // ESC 关闭 + 焦点陷阱 + 进入时聚焦
  useEffect(() => {
    if (!open) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeOnEsc) {
        e.stopPropagation();
        handleClose();
        return;
      }
      if (e.key === 'Tab') {
        const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener('keydown', onKey);

    // 锁定 body 滚动
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // 焦点进入 dialog
    requestAnimationFrame(() => {
      const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusables && focusables.length > 0) {
        focusables[0].focus();
      } else {
        dialogRef.current?.focus();
      }
    });

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open, closeOnEsc, handleClose]);

  let idCounter = useRef(0);

  const titleId = useMemo(() => `modal-title-${++idCounter.current}`, []);
  const descId = useMemo(() => (description ? `modal-desc-${++idCounter.current}` : undefined), [description]);

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && closeOnOverlay) handleClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        backdropFilter: 'blur(2px)',
        zIndex,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        animation: 'modalFadeIn 0.18s ease-out',
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={descId}
        tabIndex={-1}
        style={{
          width,
          maxWidth: '100%',
          maxHeight: 'calc(100vh - 32px)',
          background: 'var(--bg-card)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-card)',
          borderRadius: 12,
          boxShadow: '0 24px 48px rgba(0, 0, 0, 0.22)',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
          animation: 'modalSlideUp 0.22s ease-out',
        }}
      >
        {title && (
          <div
            id={titleId}
            style={{
              padding: '14px 18px',
              borderBottom: '1px solid var(--border-divider)',
              fontSize: 15,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexShrink: 0,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{title}</span>
            {onClose && (
              <button
                type="button"
                onClick={handleClose}
                aria-label="关闭对话框"
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  fontSize: 20,
                  lineHeight: 1,
                  padding: 4,
                  borderRadius: 6,
                  minWidth: 28,
                  minHeight: 28,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                ×
              </button>
            )}
          </div>
        )}
        {description && (
          <div id={descId} style={{ padding: '10px 18px 0', color: 'var(--text-muted)', fontSize: 13 }}>
            {description}
          </div>
        )}
        <div
          style={{
            padding: '16px 18px',
            overflow: 'auto',
            flex: 1,
            minHeight: 0,
            fontSize: 14,
            lineHeight: 1.6,
          }}
        >
          {children}
        </div>
        {footer && (
          <div
            style={{
              padding: '12px 18px',
              borderTop: '1px solid var(--border-divider)',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};

export default Modal;
