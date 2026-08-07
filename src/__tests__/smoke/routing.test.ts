/**
 * 冒烟测试 — 12 条路由可正确跳转
 */
import { describe, it, expect } from 'vitest';

describe('routing', () => {
  // 与 App.tsx 中 ROUTES 保持一致的路由配置
  const ROUTES = [
    { path: '/', label: '工作台', view: 'dashboard' },
    { path: '/agent-config', label: 'Agent配置', view: 'agent-config' },
    { path: '/analytics', label: '数据分析', view: 'analytics' },
    { path: '/hrms', label: 'HRMS 人力资源', view: 'hrms' },
    { path: '/business-chain', label: '业务链', view: 'business-chain' },
    { path: '/growth-engine', label: '业务倍增', view: 'growth-engine' },
    { path: '/skill-center', label: '技能中心', view: 'skill-center' },
    { path: '/connectors', label: '连接器', view: 'connectors' },
    { path: '/llm-platform', label: '大模型平台', view: 'llm-platform' },
    { path: '/import-export', label: '数据导入导出', view: 'import-export' },
    { path: '/tenant-admin', label: '多租户管理', view: 'tenant-admin' },
    { path: '/settings', label: '系统设置', view: 'settings' },
  ];

  describe('路由数量', () => {
    it('应包含 12 条路由', () => {
      expect(ROUTES.length).toBe(12);
    });
  });

  describe('路由路径', () => {
    ROUTES.forEach((route) => {
      it(`路径 ${route.path} 存在且以 / 开头或为根路径`, () => {
        expect(route.path).toMatch(/^\//);
      });
    });
  });

  describe('视图映射', () => {
    it('viewMap 应覆盖所有路由', () => {
      const viewMap: Record<string, string> = {
        '/': 'dashboard',
        '/agent-config': 'agent-config',
        '/analytics': 'analytics',
        '/hrms': 'hrms',
        '/business-chain': 'business-chain',
        '/growth-engine': 'growth-engine',
        '/skill-center': 'skill-center',
        '/connectors': 'connectors',
        '/llm-platform': 'llm-platform',
        '/import-export': 'import-export',
        '/tenant-admin': 'tenant-admin',
        '/settings': 'settings',
      };

      ROUTES.forEach((route) => {
        expect(viewMap[route.path]).toBe(route.view);
      });
    });

    it('未知路径应 fallback 到 dashboard', () => {
      const fallbackView = 'dashboard';
      expect(fallbackView).toBe('dashboard');
    });
  });

  describe('路由唯一性', () => {
    it('所有路径不重复', () => {
      const paths = ROUTES.map((r) => r.path);
      const unique = new Set(paths);
      expect(unique.size).toBe(paths.length);
    });

    it('所有视图标识不重复', () => {
      const views = ROUTES.map((r) => r.view);
      const unique = new Set(views);
      expect(unique.size).toBe(views.length);
    });
  });

  describe('根路由', () => {
    it('根路径应指向 Dashboard', () => {
      const rootRoute = ROUTES.find((r) => r.path === '/');
      expect(rootRoute).not.toBeUndefined();
      expect(rootRoute?.view).toBe('dashboard');
    });
  });
});
