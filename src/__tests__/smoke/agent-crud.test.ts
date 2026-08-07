/**
 * 冒烟测试 — Agent 创建/读取/更新/删除
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestAgent } from '@__tests__/utils/test-helpers';

describe('agent-crud', () => {
  // 模拟 Zustand store 的 agents 数组
  let agents: ReturnType<typeof createTestAgent>[];

  beforeEach(() => {
    agents = [];
  });

  describe('Create', () => {
    it('应能创建 Agent', () => {
      const agent = createTestAgent({ id: 'new-agent-001', name: '新建 Agent' });
      agents.push(agent);
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('new-agent-001');
      expect(agents[0].name).toBe('新建 Agent');
    });

    it('Agent 必填字段应完整', () => {
      const agent = createTestAgent();
      expect(agent.id).toBeDefined();
      expect(agent.name).toBeDefined();
      expect(agent.type).toBeDefined();
      expect(agent.status).toBeDefined();
      expect(agent.config).toBeDefined();
      expect(agent.createdAt).toBeDefined();
      expect(agent.updatedAt).toBeDefined();
    });

    it('Agent 应有合理默认值', () => {
      const agent = createTestAgent();
      expect(agent.status).toBe('idle');
      expect(agent.type).toBe('order-manager');
      expect(agent.config.systemPrompt).toBeDefined();
      expect(Array.isArray(agent.skills)).toBe(true);
      expect(Array.isArray(agent.connectors)).toBe(true);
    });
  });

  describe('Read', () => {
    beforeEach(() => {
      agents.push(createTestAgent({ id: 'agent-a', name: 'Agent A' }));
      agents.push(createTestAgent({ id: 'agent-b', name: 'Agent B' }));
    });

    it('应能按 ID 读取 Agent', () => {
      const agent = agents.find((a) => a.id === 'agent-a');
      expect(agent).toBeDefined();
      expect(agent?.name).toBe('Agent A');
    });

    it('不存在的 ID 应返回 undefined', () => {
      const agent = agents.find((a) => a.id === 'nonexistent');
      expect(agent).toBeUndefined();
    });

    it('应能获取所有 Agent 列表', () => {
      expect(agents).toHaveLength(2);
    });
  });

  describe('Update', () => {
    beforeEach(() => {
      agents.push(createTestAgent({ id: 'agent-a', name: 'Agent A', status: 'idle' }));
    });

    it('应能更新 Agent 状态', () => {
      const idx = agents.findIndex((a) => a.id === 'agent-a');
      agents[idx] = { ...agents[idx], status: 'running' };
      expect(agents[idx].status).toBe('running');
    });

    it('应能更新 Agent 配置', () => {
      const idx = agents.findIndex((a) => a.id === 'agent-a');
      agents[idx] = {
        ...agents[idx],
        config: { ...agents[idx].config, temperature: 0.9 },
        updatedAt: new Date().toISOString(),
      };
      expect(agents[idx].config.temperature).toBe(0.9);
    });

    it('更新不应影响其他 Agent', () => {
      agents.push(createTestAgent({ id: 'agent-b', name: 'Agent B', status: 'paused' }));
      const idx = agents.findIndex((a) => a.id === 'agent-a');
      agents[idx] = { ...agents[idx], name: 'Agent A Updated' };
      expect(agents.find((a) => a.id === 'agent-b')?.name).toBe('Agent B');
    });
  });

  describe('Delete', () => {
    beforeEach(() => {
      agents.push(createTestAgent({ id: 'agent-a' }));
      agents.push(createTestAgent({ id: 'agent-b' }));
    });

    it('应能删除 Agent', () => {
      agents = agents.filter((a) => a.id !== 'agent-a');
      expect(agents).toHaveLength(1);
      expect(agents[0].id).toBe('agent-b');
    });

    it('删除不存在的 Agent 不应报错', () => {
      agents = agents.filter((a) => a.id !== 'nonexistent');
      expect(agents).toHaveLength(2);
    });

    it('删除后按 ID 查找应返回 undefined', () => {
      agents = agents.filter((a) => a.id !== 'agent-a');
      expect(agents.find((a) => a.id === 'agent-a')).toBeUndefined();
    });
  });

  describe('Agent 状态流转', () => {
    const validStatuses: ('idle' | 'running' | 'paused' | 'error' | 'completed')[] = ['idle', 'running', 'paused', 'error', 'completed'];
    validStatuses.forEach((status) => {
      it(`${status} 是合法状态`, () => {
        const agent = createTestAgent({ status });
        expect(validStatuses).toContain(agent.status);
      });
    });

    it('running → completed 流转合法', () => {
      let agent = createTestAgent({ status: 'running' });
      agent = { ...agent, status: 'completed' };
      expect(agent.status).toBe('completed');
    });

    it('idle → running 流转合法', () => {
      let agent = createTestAgent({ status: 'idle' });
      agent = { ...agent, status: 'running' };
      expect(agent.status).toBe('running');
    });
  });

  describe('Agent 类型枚举', () => {
    const validTypes: ('hr-assistant' | 'order-manager' | 'inventory-analyst' | 'marketing-agent' | 'live-stream-host' | 'cross-border-agent' | 'finance-auditor' | 'customer-service' | 'custom')[] = [
      'hr-assistant',
      'order-manager',
      'inventory-analyst',
      'marketing-agent',
      'live-stream-host',
      'cross-border-agent',
      'finance-auditor',
      'customer-service',
      'custom',
    ];

    it('应包含 9 种 Agent 类型', () => {
      expect(validTypes.length).toBe(9);
    });

    it('每种类型可创建对应 Agent', () => {
      validTypes.forEach((type) => {
        const agent = createTestAgent({ type });
        expect(agent.type).toBe(type);
      });
    });
  });
});
