/**
 * Vorzai 电商 Agent — 全局状态管理（Zustand）
 * 统一状态层：用户、租户、Agent、连接器、专家、大模型平台
 */
import { create } from 'zustand';
import {
  Tenant, UserProfile, Agent, AgentStatus, Connector, ConnectorStatus,
  Expert, Skill, LLMPlatform, CurrentView, Theme, EventPayload,
} from '@domain/index';
import { api } from '@api/client';

interface AppStore {
  // 核心状态
  tenant: Tenant | null;
  user: UserProfile | null;
  currentView: CurrentView;
  theme: Theme;
  sidebarCollapsed: boolean;

  // 7 大核心模块数据
  agents: Agent[];
  connectors: Connector[];
  experts: Expert[];
  skills: Skill[];
  llmPlatforms: LLMPlatform[];

  // 事件总线
  listeners: Map<string, Set<(payload: EventPayload) => void>>;

  // Actions
  setTheme: (theme: Theme) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setCurrentView: (view: CurrentView) => void;
  setTenant: (tenant: Tenant | null) => void;
  setUser: (user: UserProfile | null) => void;
  logout: () => void;
  setAgents: (agents: Agent[]) => void;
  updateAgentStatus: (agentId: string, status: AgentStatus) => void;
  addAgent: (agent: Agent) => void;
  removeAgent: (agentId: string) => void;
  setConnectors: (connectors: Connector[]) => void;
  addConnector: (connector: Connector) => void;
  removeConnector: (connectorId: string) => void;
  updateConnectorStatus: (connectorId: string, status: ConnectorStatus) => void;
  setExperts: (experts: Expert[]) => void;
  setSkills: (skills: Skill[]) => void;
  setLlmPlatforms: (platforms: LLMPlatform[]) => void;
  addLLMPlatform: (platform: LLMPlatform) => void;
  removeLLMPlatform: (platformId: string) => void;

  // 事件总线
  on: (name: string, handler: (payload: EventPayload) => void) => void;
  off: (name: string, handler: (payload: EventPayload) => void) => void;
  emit: (name: string, data: Record<string, unknown>) => void;
}

export const useAppStore = create<AppStore>((set, get) => ({
  // 初始状态
  tenant: null,
  user: null,
  currentView: 'dashboard',
  theme: 'light',
  sidebarCollapsed: false,
  agents: [],
  connectors: [],
  experts: [],
  skills: [],
  llmPlatforms: [],
  listeners: new Map(),

  // 基础操作
  setTheme: (theme) => {
    set({ theme });
    get().emit('ui:theme-change', { theme });
  },
  setSidebarCollapsed: (collapsed) => {
    set({ sidebarCollapsed: collapsed });
    get().emit('ui:sidebar-toggle', { collapsed });
  },
  setCurrentView: (view) => set({ currentView: view }),
  setTenant: (tenant) => set({ tenant }),
  setUser: (user) => set({ user }),

  // 登出：调用后端注销 + 清理本地令牌/用户态
  logout: () => {
    try {
      api.auth.logout();
    } catch {
      // 后端注销失败不影响本地清理
    }
    api.clearTokens();
    set({ user: null, tenant: null });
  },

  // Agent 管理
  setAgents: (agents) => set({ agents }),
  addAgent: (agent) => set((s) => ({ agents: [...s.agents, agent] })),
  removeAgent: (agentId) => set((s) => ({ agents: s.agents.filter((a) => a.id !== agentId) })),
  updateAgentStatus: (agentId, status) => {
    set((s) => ({
      agents: s.agents.map((a) => (a.id === agentId ? { ...a, status } : a)),
    }));
    get().emit('agent:status-change', { agentId, status });
  },

  // 连接器管理
  setConnectors: (connectors) => set({ connectors }),
  addConnector: (connector) => set((s) => ({ connectors: [...s.connectors, connector] })),
  removeConnector: (connectorId) => set((s) => ({ connectors: s.connectors.filter((c) => c.id !== connectorId) })),
  updateConnectorStatus: (connectorId, status) => {
    set((s) => ({
      connectors: s.connectors.map((c) => (c.id === connectorId ? { ...c, status } : c)),
    }));
    get().emit('connector:status-change', { connectorId, status });
  },

  // 专家/技能
  setExperts: (experts) => set({ experts }),
  setSkills: (skills) => set({ skills }),

  // 大模型平台
  setLlmPlatforms: (platforms) => set({ llmPlatforms: platforms }),
  addLLMPlatform: (platform) => set((s) => ({ llmPlatforms: [...s.llmPlatforms, platform] })),
  removeLLMPlatform: (platformId) => set((s) => ({ llmPlatforms: s.llmPlatforms.filter((p) => p.id !== platformId) })),

  // 事件总线
  on: (name, handler) => {
    const listeners = get().listeners;
    if (!listeners.has(name)) {
      listeners.set(name, new Set());
    }
    listeners.get(name)!.add(handler);
  },
  off: (name, handler) => {
    const listeners = get().listeners;
    listeners.get(name)?.delete(handler);
  },
  emit: (name, data) => {
    const payload: EventPayload = {
      name: name as any,
      data,
      timestamp: new Date().toISOString(),
    };
    get().listeners.get(name)?.forEach((handler) => handler(payload));
  },
}));
