/**
 * Vorzai 电商 Agent — 多平台大模型统一接口层（适配器模式）
 * 支持动态扩展新模型平台，统一请求/响应格式
 */
import type { LLMRequest, LLMResponse, LLMPlatform } from '@domain/index';

// ────────── 适配器接口定义 ──────────
export interface LLMAdapter {
  /** 平台标识 */
  platformId: string;
  /** 平台名称 */
  platformName: string;

  /** 发送请求 */
  request(request: LLMRequest): Promise<LLMResponse>;

  /** 流式请求（可选） */
  stream?(request: LLMRequest): AsyncIterable<LLMResponse>;

  /** 健康检查 */
  healthCheck(): Promise<{ ok: boolean; latency: number }>;

  /** 获取可用模型列表 */
  listModels(): Promise<string[]>;
}

export class LLMRequestError extends Error {
  constructor(
    message: string,
    public readonly code: 'timeout' | 'network' | 'rate-limit' | 'auth-failure' | 'server-error' | 'unknown',
    public readonly statusCode?: number,
    public readonly responseText?: string,
    public readonly retryable: boolean = true,
  ) {
    super(message);
    this.name = 'LLMRequestError';
    Object.setPrototypeOf(this, LLMRequestError.prototype);
  }

  static fromResponse(statusCode: number, responseText: string): LLMRequestError {
    switch (statusCode) {
      case 401:
      case 403:
        return new LLMRequestError(`Auth failure: ${responseText}`, 'auth-failure', statusCode, responseText, false);
      case 429:
        return new LLMRequestError(`Rate limited: ${responseText}`, 'rate-limit', statusCode, responseText, true);
      case 500:
      case 502:
      case 503:
      case 504:
        return new LLMRequestError(`Server error ${statusCode}: ${responseText}`, 'server-error', statusCode, responseText, true);
      default:
        return new LLMRequestError(`API Error ${statusCode}: ${responseText}`, 'unknown', statusCode, responseText, true);
    }
  }

  static timeout(): LLMRequestError {
    return new LLMRequestError('Request timed out (60s)', 'timeout', undefined, undefined, true);
  }

  static network(): LLMRequestError {
    return new LLMRequestError('Network unreachable or DNS failure', 'network', undefined, undefined, true);
  }
}

// ────────── 通用 OpenAI 兼容适配器 ──────────
export class OpenAICompatibleAdapter implements LLMAdapter {
  constructor(
    public platformId: string,
    public platformName: string,
    private baseUrl: string,
    private apiKey: string,
  ) {}

  private async fetchJSON(path: string, body: unknown): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        // E-003: 按状态码返回分类错误，UI 层可据此区分提示/自动重试
        throw LLMRequestError.fromResponse(response.status, errorBody);
      }

      return await response.json();
    } catch (err) {
      // E-003: 区分超时与网络错误
      if (err instanceof Error && err.name === 'AbortError') {
        throw LLMRequestError.timeout();
      }
      if (err instanceof Error && err.message?.includes('fetch failed')) {
        throw LLMRequestError.network();
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async request(request: LLMRequest): Promise<LLMResponse> {
    const { model, messages, temperature, maxTokens } = request;

    const body: any = {
      model,
      messages,
    };
    if (temperature !== undefined) body.temperature = temperature;
    if (maxTokens !== undefined) body.max_tokens = maxTokens;

    const data = await this.fetchJSON('/chat/completions', body);

    return {
      content: data.choices[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: data.model ?? model,
    };
  }

  async healthCheck(): Promise<{ ok: boolean; latency: number }> {
    const start = Date.now();
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return { ok: response.ok, latency: Date.now() - start };
    } catch {
      return { ok: false, latency: Date.now() - start };
    }
  }

  async listModels(): Promise<string[]> {
    const data = await this.fetchJSON('/models', {});
    return data.data?.map((m: any) => m.id) ?? [];
  }
}

// ────────── 适配器工厂 ──────────
export class LLMAdapterFactory {
  private adapters: Map<string, LLMAdapter> = new Map();

  /** 注册适配器 */
  register(adapter: LLMAdapter): void {
    this.adapters.set(adapter.platformId, adapter);
  }

  /** 从平台配置创建适配器 */
  createFromPlatform(platform: LLMPlatform): LLMAdapter {
    // 默认使用 OpenAI 兼容协议
    const adapter = new OpenAICompatibleAdapter(
      platform.id,
      platform.name,
      platform.baseUrl,
      platform.apiKey,
    );
    this.register(adapter);
    return adapter;
  }

  /** 获取适配器 */
  get(platformId: string): LLMAdapter | undefined {
    return this.adapters.get(platformId);
  }

  /** 移除适配器 */
  remove(platformId: string): void {
    this.adapters.delete(platformId);
  }

  /** 列出所有已注册适配器 */
  list(): LLMAdapter[] {
    return Array.from(this.adapters.values());
  }

  /** 动态添加新平台（运行时扩展） */
  async addPlatform(platform: LLMPlatform): Promise<void> {
    const adapter = this.createFromPlatform(platform);
    const health = await adapter.healthCheck();
    if (!health.ok) {
      this.remove(platform.id);
      throw new Error(`Platform ${platform.name} health check failed`);
    }
  }
}

// ────────── 全局适配器管理器 ──────────
export const llmAdapterFactory = new LLMAdapterFactory();

// 预注册常见平台
export function initDefaultPlatforms(platforms: LLMPlatform[]): void {
  for (const p of platforms) {
    llmAdapterFactory.createFromPlatform(p);
  }
}
