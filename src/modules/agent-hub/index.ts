/**
 * 智能 Agent 中枢模块
 * 功能：Agent 生命周期管理、执行调度、状态监控
 */
import { moduleBus } from '@api/moduleBus';
import { llmAdapterFactory } from '@api/llmAdapter';

export interface AgentExecution {
  id: string;
  agentId: string;
  task: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

export const agentHubModule = {
  /** 执行 Agent 任务 */
  execute: async (agentId: string, task: string, config?: { model?: string; temperature?: number }) => {
    const adapter = llmAdapterFactory.get('default');
    if (!adapter) {
      throw new Error('No LLM adapter available');
    }

    moduleBus.broadcast('agent:running', { agentId, task });

    try {
      const response = await adapter.request({
        model: config?.model ?? 'gpt-4o',
        messages: [
          { role: 'system', content: 'You are a professional e-commerce assistant.' },
          { role: 'user', content: task },
        ],
        temperature: config?.temperature ?? 0.3,
      });

      moduleBus.broadcast('agent:completed', { agentId, result: response.content });
      return response;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      moduleBus.broadcast('agent:error', { agentId, error: msg });
      throw error;
    }
  },

  /** 获取 Agent 执行日志 */
  getLogs: async (agentId: string): Promise<AgentExecution[]> => {
    return [];
  },

  /** Agent 状态轮询 */
  pollStatus: async (agentId: string): Promise<string> => {
    return 'idle';
  },
};
