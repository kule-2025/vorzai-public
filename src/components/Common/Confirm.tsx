/**
 * Confirm 组件 — 二次确认对话框（替换 window.confirm）
 *
 * 两种使用方式：
 * 1) <ConfirmProvider /> + useConfirm() → Promise<boolean>
 * 2) <Confirm open onConfirm onCancel /> 直接受控使用
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';

export type ConfirmTone = 'danger' | 'warning' | 'info';

export interface ConfirmOptions {
  title: React.ReactNode;
  content?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmTone;
}

interface ConfirmContextValue {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

let externalConfirm: ConfirmContextValue['confirm'] | null = null;

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  return externalConfirm ? externalConfirm(opts) : Promise.resolve(window.confirm(typeof opts.title === 'string' ? opts.title : '确认操作？'));
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const doConfirm = useCallback((o: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
      setOpts(o);
    });
  }, []);

  useEffect(() => {
    externalConfirm = doConfirm;
    return () => {
      externalConfirm = null;
    };
  }, [doConfirm]);

  const close = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  const tone = opts?.tone ?? 'info';
  const confirmColor = tone === 'danger' ? '#ef4444' : tone === 'warning' ? '#f59e0b' : '#3b82f6';
  // B8(a11y)：用 JS 焦点管理替代 autoFocus —— 打开确认框时聚焦主操作按钮（WAI-ARIA 对话框模式）
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (opts) confirmBtnRef.current?.focus();
  }, [opts]);

  return (
    <ConfirmContext.Provider value={{ confirm: doConfirm }}>
      {children}
      <Modal
        open={!!opts}
        title={opts?.title}
        onClose={() => close(false)}
        closeOnOverlay={false}
        footer={
          <>
            <button
              type="button"
              onClick={() => close(false)}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid var(--border-card)',
                background: 'var(--bg-card)',
                color: 'var(--text-primary)',
                cursor: 'pointer',
                fontSize: 13,
                minWidth: 72,
                minHeight: 36,
              }}
            >
              {opts?.cancelText ?? '取消'}
            </button>
            <button
              type="button"
              onClick={() => close(true)}
              ref={confirmBtnRef}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: confirmColor,
                color: '#fff',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 500,
                minWidth: 72,
                minHeight: 36,
              }}
            >
              {opts?.confirmText ?? '确认'}
            </button>
          </>
        }
      >
        {opts?.content}
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    // 兜底：未包裹 Provider 时回退到 window.confirm
    return (o) => Promise.resolve(window.confirm(typeof o.title === 'string' ? o.title : '确认操作？'));
  }
  return ctx.confirm;
}

export interface ConfirmProps {
  open: boolean;
  options: ConfirmOptions;
  onConfirm: () => void;
  onCancel: () => void;
}

export const Confirm: React.FC<ConfirmProps> = ({ open, options, onConfirm, onCancel }) => {
  // B8(a11y)：用 JS 焦点管理替代 autoFocus —— 受控打开时聚焦主操作按钮
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) confirmBtnRef.current?.focus();
  }, [open]);
  return (
  <Modal
    open={open}
    title={options.title}
    onClose={onCancel}
    closeOnOverlay={false}
    footer={
      <>
        <button
          type="button"
          onClick={onCancel}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: '1px solid var(--border-card)',
            background: 'var(--bg-card)',
            color: 'var(--text-primary)',
            cursor: 'pointer',
            fontSize: 13,
            minWidth: 72,
            minHeight: 36,
          }}
        >
          {options.cancelText ?? '取消'}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          ref={confirmBtnRef}
          style={{
            padding: '8px 16px',
            borderRadius: 6,
            border: 'none',
            background: (options.tone ?? 'info') === 'danger' ? '#ef4444'
              : (options.tone ?? 'info') === 'warning' ? '#f59e0b' : '#3b82f6',
            color: '#fff',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 500,
            minWidth: 72,
            minHeight: 36,
          }}
        >
          {options.confirmText ?? '确认'}
        </button>
      </>
    }
  >
    {options.content}
  </Modal>
  );
};

export default Confirm;
