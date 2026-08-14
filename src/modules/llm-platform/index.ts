/**
 * 多平台大模型集成模块
 * 功能：统一接口层（适配器模式），动态扩展新模型
 * 支持：OpenAI、Claude、DeepSeek、GLM、Gemini、腾讯混元、通义千问、Moonshot
 */
import { moduleBus } from '@api/moduleBus';
import type { LLMAdapter } from '@api/llmAdapter';
import type { LLMRequest } from '@domain/index';
import { llmAdapterFactory, OpenAICompatibleAdapter } from '@api/llmAdapter';

// ────────── 本地接口定义（避免 index 自引用循环导入） ──────────

export interface ModelConfig {
  provider: string;
  model: string;
  apiKey: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ModelCapability {
  provider: string;
  model: string;
  contextWindow: number;
  supportsVision: boolean;
  supportsFunctionCall: boolean;
  maxInputTokens: number;
  maxOutputTokens: number;
}

// ────────── 预定义平台配置 ──────────

const DEFAULT_PLATFORMS = [
  {
    id: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
  },
  {
    id: 'anthropic',
    name: 'Anthropic / Claude',
    provider: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-3-5-sonnet', 'claude-3-opus'],
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-coder'],
  },
  {
    id: 'qwen',
    name: '通义千问',
    provider: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen-max', 'qwen-plus', 'qwen-turbo'],
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4', 'glm-4-flash'],
  },
  {
    id: 'moonshot',
    name: 'Moonshot / 月之暗面',
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['moonshot-v1-8k'],
  },
  {
    id: 'custom',
    name: '自定义 OpenAI 兼容',
    provider: 'custom',
    baseUrl: '',
    models: [],
  },
] as const;

// ────────── 模块状态 ──────────

let modelConfigs: Map<string, ModelConfig> = new Map();

export const llmPlatformModule = {
  /** 注册适配器（动态扩展） */
  registerAdapter(provider: string, adapter: LLMAdapter) {
    llmAdapterFactory.register(adapter);
    moduleBus.broadcast('llm:adapter-registered', { provider });
    console.log('[llm-platform] Adapter registered:', provider);
  },

  /** 从平台配置创建并注册适配器（内部使用） */
  _ensureAdapter(config: ModelConfig): void {
    if (llmAdapterFactory.get(config.provider)) return;
    const adapter = new OpenAICompatibleAdapter(
      config.provider,
      config.provider,
      config.baseUrl || '',
      config.apiKey,
    );
    llmAdapterFactory.register(adapter);
  },

  /** 获取可用模型列表 */
  async getModels(): Promise<ModelCapability[]> {
    const adapters = llmAdapterFactory.list();
    if (adapters.length === 0) {
      // 无适配器时返回预定义平台的模型清单（离线模式）
      return DEFAULT_PLATFORMS.flatMap((p) =>
        p.models.map((m) => ({
          provider: p.id,
          model: m,
          contextWindow: 128_000,
          supportsVision: m.includes('gpt-4o') || m.includes('claude'),
          supportsFunctionCall: true,
          maxInputTokens: 127_000,
          maxOutputTokens: 4_000,
        })),
      );
    }
    const result: ModelCapability[] = [];
    for (const adapter of adapters) {
      try {
        const models = await adapter.listModels();
        for (const m of models) {
          result.push({
            provider: adapter.platformId,
            model: m,
            contextWindow: 128_000,
            supportsVision: false,
            supportsFunctionCall: true,
            maxInputTokens: 127_000,
            maxOutputTokens: 4_000,
          });
        }
      } catch {
        // 单适配器失败不阻塞其他
      }
    }
    return result;
  },

  /** 配置模型（存入状态 + 广播） */
  async configureModel(config: ModelConfig): Promise<{ provider: string; model: string }> {
    modelConfigs.set(config.provider, config);
    this._ensureAdapter(config);
    moduleBus.broadcast('llm:model-configured', {
      provider: config.provider,
      model: config.model,
    });
    return { provider: config.provider, model: config.model };
  },

  /** 获取配置 */
  getConfig(provider: string): ModelConfig | undefined {
    return modelConfigs.get(provider);
  },

  /** 调用模型（通过已注册适配器） */
  async callModel(
    provider: string,
    messages: { role: string; content: string }[],
    options: { temperature?: number; maxTokens?: number } = {},
  ): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
    const adapter = llmAdapterFactory.get(provider);
    if (!adapter) {
      // 降级：返回模拟响应（供 UI 测试）
      return {
        content: `[mock] provider ${provider} 未配置密钥，请前往「大模型平台」配置。`,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
    const config = modelConfigs.get(provider) || { model: 'gpt-4o' };
    const request: LLMRequest = {
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 2000,
    };
    const response = await adapter.request(request);
    moduleBus.broadcast('llm:response', { provider, model: config.model });
    return {
      content: response.content,
      usage: {
        inputTokens: response.usage.promptTokens,
        outputTokens: response.usage.completionTokens,
      },
    };
  },

  /** 流式调用 */
  async streamModel(
    provider: string,
    messages: { role: string; content: string }[],
    onChunk: (text: string) => void,
    options: { temperature?: number } = {},
  ): Promise<void> {
    const adapter = llmAdapterFactory.get(provider);
    if (!adapter || !adapter.stream) {
      onChunk('');
      return;
    }
    const config = modelConfigs.get(provider) || { model: 'gpt-4o' };
    const request: LLMRequest = {
      model: config.model,
      messages: messages.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
      })),
      temperature: options.temperature ?? 0.7,
      stream: true,
    };
    try {
      for await (const chunk of adapter.stream(request)) {
        onChunk(chunk.content);
      }
    } catch {
      onChunk('[error]');
    }
  },

  /** 获取预定义平台清单 */
  getDefaultPlatforms() {
    return [...DEFAULT_PLATFORMS];
  },

  /** 获取所有配置 */
  getAllConfigs(): Map<string, ModelConfig> {
    return new Map(modelConfigs);
  },
};
