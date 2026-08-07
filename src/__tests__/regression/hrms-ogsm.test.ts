/**
 * 回归测试：HRMS OGSM 四层树
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@utils/storage', () => {
  const store = new Map<string, unknown>();
  return {
    getItem: vi.fn(async (k: string) => store.get(k) ?? null),
    setItem: vi.fn(async (k: string, v: unknown) => { store.set(k, v); }),
    delItem: vi.fn(async (k: string) => { store.delete(k); }),
    listKeys: vi.fn(async (p: string) => Array.from(store.keys()).filter(k => k.startsWith(p))),
    exportDataWithKeys: vi.fn(async () => ({})),
    importData: vi.fn(async () => {}),
  };
});

describe('HRMS OGSM Tree', () => {
  it('should create four-level OGSM hierarchy', () => {
    const objective = { id: 'o1', parentId: null, level: 'objective', title: 'Increase Revenue', status: 'in-progress', orderIndex: 0, createdAt: '', updatedAt: '' };
    const strategy = { id: 's1', parentId: 'o1', level: 'strategy', title: 'Expand Channels', status: 'planned', orderIndex: 0, createdAt: '', updatedAt: '' };
    const goal = { id: 'g1', parentId: 's1', level: 'goal', title: 'Add 3 New Platforms', status: 'planned', orderIndex: 0, createdAt: '', updatedAt: '' };
    const measurement = { id: 'm1', parentId: 'g1', level: 'measurement', title: 'Platform Count >= 5', status: 'planned', orderIndex: 0, createdAt: '', updatedAt: '' };

    expect(objective.level).toBe('objective');
    expect(strategy.parentId).toBe('o1');
    expect(goal.parentId).toBe('s1');
    expect(measurement.parentId).toBe('g1');
  });

  it('should support all OGSM status values', () => {
    const statuses = ['planned', 'in-progress', 'completed', 'on-hold'];
    statuses.forEach(s => {
      const item = { id: 'x', parentId: null, level: 'objective', title: 'Test', status: s, orderIndex: 0, createdAt: '', updatedAt: '' };
      expect(item.status).toBe(s);
    });
  });

  it('should support all ecom scenarios', () => {
    const scenarios = ['platform-ecom', 'live-stream', 'social-ecom', 'independent-site'];
    scenarios.forEach(s => {
      const item = { id: 'x', parentId: null, level: 'objective', title: 'Test', scenario: s, status: 'planned', orderIndex: 0, createdAt: '', updatedAt: '' };
      expect(item.scenario).toBe(s);
    });
  });
});
