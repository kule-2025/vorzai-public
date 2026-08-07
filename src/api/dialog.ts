/**
 * Vorzai 对话引擎 API Client
 * 与 /api/dialog 后端对接
 */

import api from './client';

export interface DialogSession {
  id: string;
  tenant_id: string;
  user_id: string;
  title: string;
  message_count: number;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface DialogMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: string;
  action_type?: string;
  action_status?: string;
  created_at: string;
}

export interface DialogAction {
  type: string;
  status: 'pending' | 'executing' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

export interface ChatResponse {
  sessionId: string;
  reply: string;
  actions: DialogAction[];
}

/** 解包 ApiResponse.data，失败时抛出 error */
function unwrap<T>(
  resp: { success: boolean; data?: T; error?: { code: string; message: string } }
): T {
  if (!resp.success) {
    throw resp.error || { code: 'UNKNOWN', message: '请求失败' };
  }
  return resp.data as T;
}

export const dialogApi = {
  /** 发送消息 */
  chatMessage: async (sessionId: string | null, input: string): Promise<ChatResponse> => {
    return unwrap<ChatResponse>(await api.dialog.chatMessage(sessionId, input));
  },

  /** 会话列表 */
  listSessions: async (): Promise<DialogSession[]> => {
    return unwrap<DialogSession[]>(await api.dialog.listSessions());
  },

  /** 创建会话 */
  createSession: async (title?: string): Promise<DialogSession> => {
    return unwrap<DialogSession>(await api.dialog.createSession(title ? { title } : {}));
  },

  /** 获取会话消息历史 */
  getSessionMessages: async (sessionId: string): Promise<DialogMessage[]> => {
    return unwrap<DialogMessage[]>(await api.dialog.getSessionMessages(sessionId));
  },

  /** 删除会话 */
  deleteSession: async (sessionId: string): Promise<{ id: string; status: string }> => {
    return unwrap<{ id: string; status: string }>(await api.dialog.deleteSession(sessionId));
  },

  /**
   * 流式对话（SSE /api/dialog/stream）。
   * 复用 client.streamChat，按真实服务端阶段事件回调：
   *   session → stage(reasoning) → reply → action*(0..n) → done
   * 返回 { promise, abort }，abort 可中断本次流式请求。
   */
  streamChat: (
    sessionId: string | null,
    message: string,
    handlers: {
      onSession?: (d: { sessionId: string }) => void;
      onStage?: (d: { stage: string; label: string }) => void;
      onReply?: (d: { messageId: string; reply: string; sources?: unknown[]; ragContext?: string; elapsedMs?: number }) => void;
      onAction?: (d: { type: string; status: string; result?: unknown; error?: string }) => void;
      onDone?: (d: { sessionId: string; messageId: string; elapsedMs?: number }) => void;
      onError?: (d: { message: string }) => void;
    }
  ): { promise: Promise<void>; abort: () => void } => {
    return api.dialog.streamChat(sessionId, message, handlers);
  },
};

export default dialogApi;
