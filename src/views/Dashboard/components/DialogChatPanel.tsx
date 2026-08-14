/**
 * Vorzai 对话面板（Dashboard 智能助手输入框替换）
 *
 * 功能：
 *   - 多轮对话气泡（左/右区分用户/助手）
 *   - 工具执行状态指示
 *   - 快捷操作按钮（常用指令）
 *   - 保持业务标签选择器风格
 *   - 颜色全部使用 CSS 变量，无硬编码
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { dialogApi, type DialogMessage, type DialogAction } from '@api/dialog';

// ==================== 快捷操作 ====================

const QUICK_ACTIONS = [
  { label: '📦 选品', text: '帮我推荐一些热门商品' },
  { label: '💰 价格', text: '查一下商品价格' },
  { label: '📋 订单', text: '查询最新订单状态' },
  { label: '📦 库存', text: '查库存状态' },
  { label: '🎯 目标', text: '查询 OGSM 目标进度' },
  { label: '👥 人效', text: '查询本月人效指标' },
  { label: '🎫 工单', text: '创建售后工单' },
  { label: '📊 组盘', text: '帮我创建商品套餐' },
];

// ==================== SVG 图标 ====================

const ICONS = {
  send: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2L11 13M22 2l-7 20-4-9-9-4z" />
    </svg>
  ),
  collapse: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 15l-6-6-6 6" />
    </svg>
  ),
  expand: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  ),
  newChat: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  ),
};

// ==================== 工具执行状态标签 ====================

const ACTION_STATUS_LABEL: Record<string, string> = {
  pending: '⏳ 等待执行',
  executing: '⚡ 执行中...',
  done: '✅ 已完成',
  error: '❌ 执行失败',
};

// ==================== 消息气泡 ====================

function MessageBubble({ msg }: { msg: DialogMessage }) {
  const isUser = msg.role === 'user';
  const isTool = msg.role === 'tool';

  if (isTool) {
    const content = parseActionContent(msg.content);
    if (!content || (!content.type && !content.status)) return null;
    const statusLabel = ACTION_STATUS_LABEL[content.status || 'done'] || '';
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          marginBottom: 4,
        }}
      >
        <div
          style={{
            maxWidth: '70%',
            padding: '6px 10px',
            borderRadius: 8,
            background: 'var(--bg-row-hover)',
            border: '1px solid var(--border-color)',
            fontSize: 11,
            color: 'var(--text-muted)',
            lineHeight: 1.4,
          }}
        >
          <span style={{ fontWeight: 600 }}>{content.type || '操作'}</span>
          <span style={{ marginLeft: 6 }}>{statusLabel}</span>
          {content.error && (
            <div style={{ marginTop: 2, color: 'var(--danger-text)' }}>{content.error}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 8,
      }}
    >
      <div
        style={{
          maxWidth: '80%',
          padding: '8px 12px',
          borderRadius: 12,
          background: isUser ? 'var(--bg-sidebar-active)' : 'var(--bg-card)',
          color: isUser ? 'var(--text-light)' : 'var(--text-primary)',
          border: isUser ? 'none' : '1px solid var(--border-card)',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {msg.content}
      </div>
    </div>
  );
}

function parseActionContent(content: string): { type?: string; status?: string; error?: string } {
  try {
    return JSON.parse(content);
  } catch (e) {
    console.warn('[DialogChatPanel] 解析action内容失败:', e);
    return {};
  }
}

// ==================== 快捷操作按钮 ====================

function QuickActionButtons({ onSend }: { onSend: (text: string) => Promise<void> }) {
  return (
    <div
      style={{
        display: 'flex',
        gap: 4,
        overflowX: 'auto',
        padding: '6px 0',
        borderBottom: '1px solid var(--border-color)',
      }}
    >
      {QUICK_ACTIONS.map((action) => (
        <button
          key={action.label}
          onClick={() => onSend(action.text)}
          style={{
            flex: 'none',
            padding: '4px 8px',
            borderRadius: 12,
            background: 'transparent',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border-color)',
            fontSize: 11,
            cursor: 'pointer',
            transition: 'all var(--transition-fast)',
            whiteSpace: 'nowrap',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-row-hover)';
            e.currentTarget.style.borderColor = 'var(--border-card)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'var(--border-color)';
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

// ==================== 主组件 ====================

export default function DialogChatPanel() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<DialogMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [stageLabel, setStageLabel] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [editorHeight, setEditorHeight] = useState(36);
  const messagesRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<{ abort: () => void } | null>(null);
  // 工具消息 ID 计数器：onAction 回调无服务端 ID，用递增序号保证唯一性（替代 Math.random）
  const actionIdCounter = useRef(0);

  // 卸载时中断未完成的流式请求，避免泄漏
  useEffect(() => () => { streamRef.current?.abort(); }, []);

  // 滚动到底部
  const scrollToBottom = useCallback(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    }
  }, []);

  // 创建新会话并加载消息
  const loadSession = useCallback(async (sid: string) => {
    try {
      const msgs = await dialogApi.getSessionMessages(sid);
      setMessages(msgs);
      setSessionId(sid);
    } catch (e) {
      console.warn('[DialogChatPanel] 加载会话消息失败:', e);
      setMessages([]);
    }
  }, []);

  // 新建会话
  const createNewSession = useCallback(async () => {
    try {
      const session = await dialogApi.createSession();
      setMessages([]);
      setSessionId(session.id);
    } catch (e) {
      // 即使创建失败，也允许在当前会话发送（后端会 auto-create）
      console.warn('[DialogChatPanel] 创建会话失败:', e);
      setSessionId(null);
      setMessages([]);
    }
  }, []);

  // 发送消息（流式 SSE：session → stage(reasoning) → reply → action* → done）
  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: DialogMessage = {
      id: `user-${Date.now()}`,
      session_id: sessionId || '',
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };

    const currentSession = sessionId;
    let effectiveSession = currentSession;
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setEditorHeight(36);
    setLoading(true);
    setStageLabel('正在连接…');
    scrollToBottom();

    const { promise, abort } = dialogApi.streamChat(currentSession, trimmed, {
      onSession: (d) => {
        if (d.sessionId) {
          if (!currentSession) setSessionId(d.sessionId);
          effectiveSession = d.sessionId;
        }
      },
      onStage: (d) => setStageLabel(d.label),
      onReply: (d) => {
        setStageLabel(null);
        const assistantMsg: DialogMessage = {
          id: d.messageId || `assistant-${Date.now()}`,
          session_id: effectiveSession || '',
          role: 'assistant',
          content: d.reply,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        scrollToBottom();
      },
      onAction: (d) => {
        // 服务端 action 事件不含独立 ID；用单调递增序号保证 key 稳定唯一
        const actionId = `action-${Date.now()}-${++actionIdCounter.current}`;
        const toolMsg: DialogMessage = {
          id: actionId,
          session_id: effectiveSession || '',
          role: 'tool',
          content: JSON.stringify({ type: d.type, status: d.status, error: d.error }),
          action_type: d.type,
          action_status: d.status,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, toolMsg]);
        scrollToBottom();
      },
      onDone: () => {
        setStageLabel(null);
        setLoading(false);
      },
      onError: (d) => {
        setStageLabel(null);
        const errorMsg: DialogMessage = {
          id: `error-${Date.now()}`,
          session_id: '',
          role: 'assistant',
          content: `抱歉，服务暂时不可用：${d.message}`,
          created_at: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, errorMsg]);
        setLoading(false);
        scrollToBottom();
      },
    });
    streamRef.current = { abort };

    try {
      await promise;
    } catch (e) {
      // 网络层异常 / 主动 abort 兜底
      console.warn('[DialogChatPanel] 发送消息失败:', e);
      setStageLabel(null);
      setLoading(false);
    }
  }, [loading, sessionId, scrollToBottom]);

  // 键盘发送
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  return (
    <div
      style={{
        marginTop: 'auto',
        background: 'var(--bg-card)',
        borderRadius: 12,
        border: '1px solid var(--border-input)',
        boxShadow: 'var(--shadow-card)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* 标题栏 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: '1px solid var(--border-color)',
          cursor: 'pointer',
        }}
        onClick={() => setExpanded((v) => !v)}
      >
        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
          🤖 智能助手
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>
          支持选品 · 订单 · 库存 · OGSM · 人效 · 客服
        </span>
        <button
          style={{
            width: 24, height: 24, borderRadius: 6,
            border: '1px solid var(--border-color)',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
          title="新建会话"
          onClick={(e) => { e.stopPropagation(); createNewSession(); }}
        >
          {ICONS.newChat}
        </button>
        <button
          style={{
            width: 24, height: 24, borderRadius: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: 0,
          }}
        >
          {expanded ? ICONS.collapse : ICONS.expand}
        </button>
      </div>

      {/* 展开区域 */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {/* 快捷操作 */}
          <QuickActionButtons onSend={sendMessage} />

          {/* 消息列表 */}
          <div
            ref={messagesRef}
            style={{
              flex: 1,
              maxHeight: 320,
              overflowY: 'auto',
              padding: '8px 12px',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {messages.length === 0 ? (
              <div
                style={{
                  textAlign: 'center',
                  color: 'var(--text-muted)',
                  fontSize: 12,
                  marginTop: 30,
                  lineHeight: 1.6,
                }}
              >
                试试点击上方的快捷操作，<br />
                或直接输入您的问题
              </div>
            ) : (
              messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
            )}
            {loading && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  marginBottom: 4,
                }}
              >
                <div
                  style={{
                    padding: '6px 12px',
                    borderRadius: 12,
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    fontSize: 12,
                    color: 'var(--text-muted)',
                  }}
                >
                  ⏳ {stageLabel || '正在思考…'}
                </div>
              </div>
            )}
          </div>

          {/* 输入框 */}
          <div style={{ padding: '8px 12px 12px' }}>
            <textarea
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setEditorHeight(Math.min(120, Math.max(36, e.target.scrollHeight)));
              }}
              onKeyDown={handleKeyDown}
              placeholder="输入指令，如：帮我推荐热门商品、查库存状态..."
              disabled={loading}
              style={{
                width: '100%',
                height: editorHeight,
                border: '1px solid var(--border-color)',
                borderRadius: 8,
                outline: 'none',
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--text-primary)',
                background: 'var(--bg-card)',
                resize: 'none',
                padding: '8px 10px',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 4 }}>
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                style={{
                  height: 28,
                  padding: '0 12px',
                  borderRadius: 8,
                  background: input.trim() && !loading ? 'var(--bg-sidebar-active)' : 'var(--bg-row-hover)',
                  color: input.trim() && !loading ? 'var(--text-light)' : 'var(--text-muted)',
                  border: 'none',
                  cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 12,
                  fontWeight: 500,
                  transition: 'all var(--transition-fast)',
                }}
              >
                {ICONS.send}
                {loading ? '发送中' : '发送'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
