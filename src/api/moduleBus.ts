/**
 * Vorzai 电商 Agent — 7 大核心模块通信总线
 * 模块间解耦通信，基于事件驱动的发布-订阅模式
 */
import type { ModuleMessage, ModuleRegistry, EventName } from '@domain/index';

// ────────── 7 大核心模块注册 ──────────
export const MODULE_REGISTRY: ModuleRegistry = {
  'hr-system': {
    name: '人力系统对接',
    version: '1.0.0',
    endpoints: [
      '/api/v1/hr/employees',
      '/api/v1/hr/attendance',
      '/api/v1/hr/performance',
      '/api/v1/hr/payroll',
    ],
    events: [
      'hr:employee-change',
      'hr:attendance-update',
      'hr:performance-ready',
    ],
    dependencies: ['connectors'],
  },
  'business-chain': {
    name: '业务链打通',
    version: '1.0.0',
    endpoints: [
      '/api/v1/chain/orders',
      '/api/v1/chain/inventory',
      '/api/v1/chain/supply',
      '/api/v1/chain/settlement',
    ],
    events: [
      'chain:order-created',
      'chain:order-status-change',
      'chain:inventory-alert',
      'chain:settlement-ready',
    ],
    dependencies: ['connectors', 'hr-system'],
  },
  'agent-hub': {
    name: '智能Agent中枢',
    version: '1.0.0',
    endpoints: [
      '/api/v1/agents',
      '/api/v1/agents/:id/execute',
      '/api/v1/agents/:id/status',
      '/api/v1/agents/:id/logs',
    ],
    events: [
      'agent:status-change',
      'agent:running',
      'agent:completed',
      'agent:error',
    ],
    dependencies: ['llm-platform', 'skill-center'],
  },
  'growth-engine': {
    name: '业务倍增引擎',
    version: '1.0.0',
    endpoints: [
      '/api/v1/growth/campaigns',
      '/api/v1/growth/optimization',
      '/api/v1/growth/recommendations',
      '/api/v1/growth/metrics',
    ],
    events: [
      'growth:campaign-start',
      'growth:optimization-ready',
      'growth:metric-update',
    ],
    dependencies: ['agent-hub', 'analytics'],
  },
  'skill-center': {
    name: '技能/专家中心',
    version: '1.0.0',
    endpoints: [
      '/api/v1/experts',
      '/api/v1/experts/:id',
      '/api/v1/skills',
      '/api/v1/skills/:id',
    ],
    events: [
      'skill:install',
      'skill:update',
      'expert:activate',
      'expert:deactivate',
    ],
    dependencies: ['llm-platform'],
  },
  'connectors': {
    name: '连接器模块',
    version: '1.0.0',
    endpoints: [
      '/api/v1/connectors',
      '/api/v1/connectors/email',
      '/api/v1/connectors/email/:id/connect',
      '/api/v1/connectors/email/:id/sync',
      '/api/v1/connectors/email/:id/send',
      '/api/v1/connectors/email/:id/logs',
      '/api/v1/connectors/:id/sync',
      '/api/v1/connectors/:id/status',
      '/api/v1/connectors/:id/config',
    ],
    events: [
      'connector:status-change',
      'connector:sync-complete',
      'connector:sync-error',
      'email:connector-connected',
      'email:connector-disconnected',
      'email:inbox-synced',
      'email:email-sent',
    ],
    dependencies: [],
  },
  'llm-platform': {
    name: '多平台大模型集成',
    version: '1.0.0',
    endpoints: [
      '/api/v1/llm/platforms',
      '/api/v1/llm/platforms/:id/models',
      '/api/v1/llm/chat',
      '/api/v1/llm/stream',
    ],
    events: [
      'llm:model-change',
      'llm:request',
      'llm:response',
      'llm:error',
    ],
    dependencies: [],
  },
};

// ────────── 模块间通信总线 ──────────
export class ModuleBus {
  private listeners: Map<string, Set<(msg: ModuleMessage) => void>> = new Map();
  private registry: ModuleRegistry;

  constructor(registry: ModuleRegistry = MODULE_REGISTRY) {
    this.registry = registry;
  }

  /** 注册模块事件监听器 */
  on(moduleId: string, event: string, handler: (msg: ModuleMessage) => void): void {
    const key = `${moduleId}:${event}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, new Set());
    }
    this.listeners.get(key)!.add(handler);
  }

  /** 取消监听 */
  off(moduleId: string, event: string, handler: (msg: ModuleMessage) => void): void {
    const key = `${moduleId}:${event}`;
    this.listeners.get(key)?.delete(handler);
  }

  /** 模块间发送消息 */
  send(from: string, to: string, type: string, payload: Record<string, unknown>): void {
    const msg: ModuleMessage = {
      from,
      to,
      type,
      payload,
      timestamp: new Date().toISOString(),
    };

    // 发送给目标模块的监听器
    const toKey = `${to}:${type}`;
    this.listeners.get(toKey)?.forEach((handler) => handler(msg));

    // 广播给所有模块的 'module:message' 监听器
    const allMsgKey = `${from}:module:message`;
    this.listeners.get(allMsgKey)?.forEach((handler) => handler(msg));
  }

  /** 模块广播事件（所有订阅者接收） */
  broadcast(event: string, payload: Record<string, unknown>): void {
    this.listeners.get(event)?.forEach((handler) =>
      handler({
        from: 'bus',
        to: '*',
        type: event,
        payload,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  /** 查询模块信息 */
  getModule(moduleId: string): ModuleRegistry[string] | undefined {
    return this.registry[moduleId];
  }

  /** 列出所有模块 */
  listModules(): string[] {
    return Object.keys(this.registry);
  }
}

// ────────── 全局模块总线实例 ──────────
export const moduleBus = new ModuleBus();
