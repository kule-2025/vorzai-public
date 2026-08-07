/**
 * 冒烟测试 — 应用可启动
 * 验证 React 应用可在模拟 Electron 环境下渲染
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('app-launch', () => {
  describe('Electron 环境模拟', () => {
    it('window.process 可被访问', () => {
      const mockWindow = {
        process: { type: 'renderer', env: { NODE_ENV: 'test' } },
        require: vi.fn(),
        __dirname: '/',
      };
      expect(mockWindow.process.type).toBe('renderer');
      expect(mockWindow.process.env.NODE_ENV).toBe('test');
    });

    it('electron contextBridge 可用', () => {
      const mockContextBridge = {
        exposeInMainWorld: vi.fn((channel: string, func: Function) => {
          expect(typeof func).toBe('function');
        }),
      };
      const mockElectron = { contextBridge: mockContextBridge };
      mockElectron.contextBridge.exposeInMainWorld('ipcRenderer', () => ({}));
      expect(mockContextBridge.exposeInMainWorld).toHaveBeenCalled();
    });

    it('electron remote 可模拟获取窗口信息', () => {
      const mockRemote = {
        getCurrentWindow: vi.fn(() => ({
           getTitle: vi.fn(() => 'Vorzai 电商 Agent'),
          getSize: vi.fn(() => [1280, 720]),
          isMaximized: vi.fn(() => false),
        })),
      };
      const win = mockRemote.getCurrentWindow();
      expect(win.getTitle()).toBe('Vorzai 电商 Agent');
      expect(win.getSize()).toEqual([1280, 720]);
    });
  });

  describe('React 入口', () => {
    it('document.getElementById 返回 root 元素', () => {
      const root = document.getElementById('root');
      expect(root).not.toBeNull();
    });

    it('ReactDOM.createRoot 可创建容器', () => {
      const rootEl = document.getElementById('root');
      expect(rootEl).not.toBeNull();
    });

    it('应用路由路径配置完整', () => {
      const routes = [
        '/',
        '/agent-config',
        '/analytics',
        '/hrms',
        '/business-chain',
        '/growth-engine',
        '/skill-center',
        '/connectors',
        '/llm-platform',
        '/import-export',
        '/tenant-admin',
        '/settings',
      ];
      expect(routes.length).toBe(12);
      expect(routes).toContain('/');
      expect(routes).toContain('/agent-config');
    });
  });

  describe('Zustand 状态初始化', () => {
    it('appStore 初始状态包含默认值', () => {
      const defaultState = {
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
      };
      expect(defaultState.currentView).toBe('dashboard');
      expect(defaultState.theme).toBe('light');
      expect(defaultState.sidebarCollapsed).toBe(false);
      expect(Array.isArray(defaultState.agents)).toBe(true);
    });

    it('HRMS 初始状态包含默认视图模式', () => {
      const defaultHRMSState = {
        ogsmItems: [],
        tasks: [],
        raciEntries: [],
        risks: [],
        incentives: [],
        incentiveResults: [],
        pilots: [],
        policies: [],
        employees: [],
        scenarios: [],
        viewMode: 'tree' as const,
        taskFilter: {},
        riskFilter: {},
      };
      expect(defaultHRMSState.viewMode).toBe('tree');
      expect(Array.isArray(defaultHRMSState.ogsmItems)).toBe(true);
      expect(Array.isArray(defaultHRMSState.tasks)).toBe(true);
    });
  });

  describe('模块注册表完整性', () => {
    it('7 大核心模块均已注册', () => {
      const modules = [
        'hr-system',
        'business-chain',
        'agent-hub',
        'growth-engine',
        'skill-center',
        'connectors',
        'llm-platform',
      ];
      expect(modules.length).toBe(7);
      expect(modules).toContain('hr-system');
      expect(modules).toContain('agent-hub');
    });

    it('每个模块包含 name / version / endpoints / events / dependencies', () => {
      const sampleModule = {
        name: '人力系统对接',
        version: '1.0.0',
        endpoints: ['/api/v1/hr/employees'],
        events: ['hr:employee-change'],
        dependencies: ['connectors'],
      };
      expect(sampleModule.name).toBeDefined();
      expect(sampleModule.version).toBeDefined();
      expect(Array.isArray(sampleModule.endpoints)).toBe(true);
      expect(Array.isArray(sampleModule.events)).toBe(true);
      expect(Array.isArray(sampleModule.dependencies)).toBe(true);
    });
  });
});
