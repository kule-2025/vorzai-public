import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

// ============================================================
// Toast 组件 — 全局操作反馈
// 支持类型: success / error / warning / info
// 自动消失: 3s（error 5s）
// ============================================================

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastContextValue {
  toasts: ToastMessage[];
  addToast: (type: ToastType, title: string, message?: string) => void;
  removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextId = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const addToast = useCallback((type: ToastType, title: string, message?: string) => {
    const id = ++nextId;
    const duration = type === 'error' ? 5000 : 3000;
    const toast: ToastMessage = { id, type, title, message, duration };
    setToasts((prev) => [...prev.slice(-4), toast]); // 最多 5 个
    const timer = setTimeout(() => removeToast(id), duration);
    timersRef.current.set(id, timer);
  }, [removeToast]);

  // 清理所有定时器
  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
      {children}
      <ToastContainer />
    </ToastContext.Provider>
  );

  function ToastContainer() {
    if (toasts.length === 0) return null;

    const colors: Record<ToastType, { bg: string; border: string; icon: string }> = {
      success: { bg: '#f0fdf4', border: '#22c55e', icon: 'M5 13l4 4L19 7' },
      error: { bg: '#fef2f2', border: '#ef4444', icon: 'M6 18L18 6M6 6l12 12' },
      warning: { bg: '#fffbeb', border: '#f59e0b', icon: 'M12 9v2m0 4h.01' },
      info: { bg: '#eff6ff', border: '#3b82f6', icon: 'M13 16h-1v-4h-1m1-4h.01' },
    };

    return (
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 10000,
          display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360,
          pointerEvents: 'none',
        }}
      >
        {toasts.map((t) => {
          const c = colors[t.type];
          return (
            <div
              key={t.id}
              role="alert"
              style={{
                background: c.bg, borderLeft: `4px solid ${c.border}`,
                borderRadius: 8, padding: '12px 16px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                display: 'flex', gap: 10, alignItems: 'flex-start',
                animation: 'toastSlideIn 0.3s ease-out',
                pointerEvents: 'auto', cursor: 'default',
              }}
              onClick={() => removeToast(t.id)}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                stroke={c.border} strokeWidth="2" strokeLinecap="round"
                style={{ flexShrink: 0, marginTop: 1 }}
              >
                <path d={c.icon} />
              </svg>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, color: '#1e293b' }}>{t.title}</div>
                {t.message && (
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>{t.message}</div>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeToast(t.id); }}
                aria-label="关闭"
                style={{
                  background: 'none', border: 'none', fontSize: 16, cursor: 'pointer',
                  color: '#94a3b8', padding: 0, lineHeight: 1, flexShrink: 0,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    );
  }
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// 兼容非 React 环境的外部调用（供 api client 等纯 TS 模块使用）
let externalAddToast: ToastContextValue['addToast'] | null = null;
export function setExternalToast(fn: ToastContextValue['addToast']) { externalAddToast = fn; }
export function toast(type: ToastType, title: string, message?: string) {
  externalAddToast?.(type, title, message);
}
