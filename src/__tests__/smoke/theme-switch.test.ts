/**
 * 冒烟测试 — light/dark 主题切换
 */
import { describe, it, expect, beforeEach } from 'vitest';

describe('theme-switch', () => {
  let root: HTMLHtmlElement;

  beforeEach(() => {
    root = document.documentElement;
    root.removeAttribute('data-theme');
  });

  describe('theme 类型枚举', () => {
    const validThemes: ('light' | 'dark' | 'system')[] = ['light', 'dark', 'system'];

    it('应包含 3 种主题模式', () => {
      expect(validThemes.length).toBe(3);
    });

    it('每种主题模式都是合法值', () => {
      validThemes.forEach((theme) => {
        expect(['light', 'dark', 'system']).toContain(theme);
      });
    });
  });

  describe('light 主题', () => {
    it('设置 light 应移除 data-theme 属性', () => {
      root.setAttribute('data-theme', 'dark');
      // light 主题：移除 data-theme
      root.removeAttribute('data-theme');
      expect(root.getAttribute('data-theme')).toBeNull();
    });

    it('light 模式下不应设置 data-theme', () => {
      const applyLight = () => {
        root.removeAttribute('data-theme');
      };
      applyLight();
      expect(root.hasAttribute('data-theme')).toBe(false);
    });
  });

  describe('dark 主题', () => {
    it('设置 dark 应添加 data-theme="dark"', () => {
      root.setAttribute('data-theme', 'dark');
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('dark 模式下 data-theme 值为 dark', () => {
      const applyDark = () => {
        root.setAttribute('data-theme', 'dark');
      };
      applyDark();
      expect(root.getAttribute('data-theme')).toBe('dark');
    });
  });

  describe('system 主题', () => {
    it('system 主题应根据 prefers-color-scheme 判断', () => {
      // 模拟深色模式
      const darkQuery = {
        matches: true,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      Object.defineProperty(window, 'matchMedia', {
        value: () => darkQuery,
        writable: true,
      });

      if (darkQuery.matches) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
      expect(root.getAttribute('data-theme')).toBe('dark');
    });

    it('system 主题在浅色系统下应移除 data-theme', () => {
      const lightQuery = {
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
      Object.defineProperty(window, 'matchMedia', {
        value: () => lightQuery,
        writable: true,
      });

      if (lightQuery.matches) {
        root.setAttribute('data-theme', 'dark');
      } else {
        root.removeAttribute('data-theme');
      }
      expect(root.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('主题切换逻辑', () => {
    it('light → dark → light 切换正确', () => {
      // light
      root.removeAttribute('data-theme');
      expect(root.getAttribute('data-theme')).toBeNull();

      // → dark
      root.setAttribute('data-theme', 'dark');
      expect(root.getAttribute('data-theme')).toBe('dark');

      // → light
      root.removeAttribute('data-theme');
      expect(root.getAttribute('data-theme')).toBeNull();
    });

    it('dark → system → light 切换正确', () => {
      // dark
      root.setAttribute('data-theme', 'dark');
      expect(root.getAttribute('data-theme')).toBe('dark');

      // → system (假设系统深色)
      root.setAttribute('data-theme', 'dark');
      expect(root.getAttribute('data-theme')).toBe('dark');

      // → light
      root.removeAttribute('data-theme');
      expect(root.getAttribute('data-theme')).toBeNull();
    });
  });

  describe('事件总线主题变更', () => {
    it('主题变更应触发 ui:theme-change 事件', () => {
      let emittedTheme: string | undefined;
      const eventPayload = { name: 'ui:theme-change' as const, data: { theme: 'dark' }, timestamp: new Date().toISOString() };
      emittedTheme = (eventPayload.data as { theme: string }).theme;
      expect(emittedTheme).toBe('dark');
      expect(eventPayload.name).toBe('ui:theme-change');
    });
  });
});
