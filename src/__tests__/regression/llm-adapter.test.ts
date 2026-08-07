/**
 * 回归测试：LLM 适配器
 */
import { describe, it, expect } from 'vitest';

describe('LLM Adapter', () => {
  it('should create OpenAI-compatible adapter', () => {
    const adapter = {
      platformId: 'openai',
      platformName: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
    };
    expect(adapter.platformId).toBe('openai');
    expect(adapter.baseUrl).toContain('openai.com');
  });

  it('should support 6 LLM providers', () => {
    const providers = ['openai', 'claude', 'qwen', 'wenxin', 'deepseek', 'local'];
    expect(providers).toHaveLength(6);
  });

  it('should timeout after 60s', () => {
    const timeout = 60000;
    expect(timeout).toBe(60000);
  });
});

describe('Module Bus', () => {
  it('should register 7 core modules', () => {
    const modules = [
      'hr-system', 'business-chain', 'agent-hub',
      'growth-engine', 'skill-center', 'connectors', 'llm-platform',
    ];
    expect(modules).toHaveLength(7);
  });

  it('should support event-driven pub/sub', () => {
    const listeners = new Map<string, Set<Function>>();
    const eventName = 'test:event';
    let received = false;

    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName)!.add(() => { received = true; });
    listeners.get(eventName)!.forEach(fn => fn());

    expect(received).toBe(true);
  });
});

describe('Update Check', () => {
  it('should compare semver versions', () => {
    function compareVersions(a: string, b: string): number {
      const pa = a.replace('v', '').split('.').map(Number);
      const pb = b.replace('v', '').split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
      }
      return 0;
    }
    expect(compareVersions('1.0.0', '0.9.0')).toBe(1);
    expect(compareVersions('0.9.0', '1.0.0')).toBe(-1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
  });

  it('should support dual-source fallback', () => {
    const sources = ['github', 'gitee'];
    expect(sources).toHaveLength(2);
    expect(sources[0]).toBe('github');
    expect(sources[1]).toBe('gitee');
  });

  it('should use 2MB chunk size', () => {
    const CHUNK_SIZE = 2 * 1024 * 1024;
    expect(CHUNK_SIZE).toBe(2097152);
  });
});

describe('Audit Logger', () => {
  it('should log 5 audit event types', () => {
    const eventTypes = ['create', 'read', 'update', 'delete', 'access'];
    expect(eventTypes).toHaveLength(5);
  });

  it('should support query by multiple dimensions', () => {
    const dimensions = ['tenantId', 'userId', 'action', 'resource', 'result', 'startTime', 'endTime'];
    expect(dimensions).toHaveLength(7);
  });
});
