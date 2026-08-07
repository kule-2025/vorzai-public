/**
 * 全局类型声明 — Electron API 与 Node.js 环境
 * 供 auto-update 模块使用
 */

declare global {
  interface Window {
    electronAPI?: {
      getAppVersion?: () => string;
      getApplicationPath?: () => string;
      fileWrite?: (path: string, data: ArrayBuffer | string) => Promise<void>;
      fileMove?: (from: string, to: string) => Promise<void>;
      fileDelete?: (path: string) => Promise<void>;
      fileRead?: (path: string) => Promise<ArrayBuffer>;
      windowRelaunch?: () => void;
    };
  }

  interface NodeJS {
    global: typeof globalThis;
  }
}

export interface AppInfo {
  version: string;
  platform: string;
  appPath: string;
}

export {};
