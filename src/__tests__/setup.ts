/**
 * 测试环境全局设置
 * Mock 浏览器 API（localStorage / indexedDB / crypto / navigator）
 */
import { vi } from 'vitest';

// ─── 全局测试前/后重置 ───
beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── localStorage mock ───
const localStorageMock: Record<string, string> = {};

Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => localStorageMock[key] ?? null),
    setItem: vi.fn((key: string, value: string) => { localStorageMock[key] = String(value); }),
    removeItem: vi.fn((key: string) => { delete localStorageMock[key]; }),
    clear: vi.fn(() => { for (const k in localStorageMock) delete localStorageMock[k]; }),
    get length() { return Object.keys(localStorageMock).length; },
    key: vi.fn((index: number) => Object.keys(localStorageMock)[index] ?? null),
  },
  writable: true,
});

// ─── indexedDB mock ───
class MockIDBRequest {
  result: any = null;
  error: any = null;
  onsuccess = () => {};
  onerror = () => {};
  constructor(private resolveValue: any) {
    setTimeout(() => {
      this.result = this.resolveValue;
      this.onsuccess();
    }, 0);
  }
}

class MockIDBObjectStore {
  constructor(private name: string, private data = new Map<string, any>()) {}
  get(key: string) {
    return new MockIDBRequest(this.data.get(key) ?? null);
  }
  put(value: any, key: string) {
    this.data.set(key, value);
    return new MockIDBRequest(null);
  }
  delete(key: string) {
    this.data.delete(key);
    return new MockIDBRequest(null);
  }
  clear() {
    this.data.clear();
    return new MockIDBRequest(null);
  }
  getAll() {
    return new MockIDBRequest(Array.from(this.data.values()));
  }
  getAllKeys() {
    return new MockIDBRequest(Array.from(this.data.keys()));
  }
}

class MockIDBTransaction {
  constructor(
    private dbName: string,
    private storeName: string,
    private mode: 'readonly' | 'readwrite' = 'readonly',
  ) {}
  objectStore(name: string) {
    return new MockIDBObjectStore(name);
  }
}

class MockIDBDatabase {
  objectStoreNames = new Set<string>();
  constructor(
    private name: string,
    private stores = new Map<string, MockIDBObjectStore>(),
  ) {
    for (const s of this.stores.values()) this.objectStoreNames.add(s.name);
  }
  transaction(storeName: string, mode?: 'readonly' | 'readwrite') {
    const store = this.stores.get(storeName);
    if (store) return new MockIDBTransaction(this.name, storeName, mode);
    const newStore = new MockIDBObjectStore(storeName);
    this.stores.set(storeName, newStore);
    this.objectStoreNames.add(storeName);
    return new MockIDBTransaction(this.name, storeName, mode);
  }
}

const mockDBs = new Map<string, MockIDBDatabase>();

Object.defineProperty(globalThis, 'indexedDB', {
  value: {
    open: vi.fn((name: string, version?: number) => {
      let db = mockDBs.get(name);
      if (!db) {
        db = new MockIDBDatabase(name);
        mockDBs.set(name, db);
      }
      const req = new MockIDBRequest(db);
      return req;
    }),
    deleteDatabase: vi.fn(),
  },
  writable: true,
});

// ─── crypto.subtle mock ───
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = {
    subtle: {
      importKey: vi.fn().mockResolvedValue({}),
      sign: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3])),
      digest: vi.fn().mockResolvedValue(new Uint8Array([0, 1, 2, 3])),
    },
  };
}

// ─── navigator mock ───
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'BisuEcommerce/0.1.0 (Test)',
    clipboard: { writeText: vi.fn(), readText: vi.fn() },
  },
  writable: true,
});

// ─── URL.createObjectURL mock ───
let mockUrlCounter = 0;
globalThis.URL.createObjectURL = vi.fn(() => `mock-blob-url-${++mockUrlCounter}`);
globalThis.URL.revokeObjectURL = vi.fn();

// ─── performance mock ───
globalThis.performance.now = vi.fn(() => 0);

// ─── window.matchMedia mock ───
Object.defineProperty(globalThis, 'matchMedia', {
  value: vi.fn().mockReturnValue({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }),
  writable: true,
});

// ─── document mock (Node 环境) ───
class MockHTMLElement {
  private _attrs: Map<string, string> = new Map();
  getAttribute(name: string) { return this._attrs.get(name) ?? null; }
  setAttribute(name: string, value: string) { this._attrs.set(name, value); }
  removeAttribute(name: string) { this._attrs.delete(name); }
  hasAttribute(name: string) { return this._attrs.has(name); }
  firstChild: MockHTMLElement | null = null;
  childNodes: MockHTMLElement[] = [];
}

const mockElements: Map<string, MockHTMLElement> = new Map();
function getOrCreateMockEl(id: string) {
  let el = mockElements.get(id);
  if (!el) { el = new MockHTMLElement(); mockElements.set(id, el); }
  return el;
}

Object.defineProperty(globalThis, 'document', {
  value: {
    createElement: vi.fn((tag: string) => new MockHTMLElement()),
    getElementById: vi.fn((id: string) => getOrCreateMockEl(id)),
    querySelector: vi.fn((sel: string) => getOrCreateMockEl(sel)),
    documentElement: new MockHTMLElement(),
    body: new MockHTMLElement(),
  },
  writable: true,
});

Object.defineProperty(globalThis, 'window', {
  value: {
    matchMedia: vi.fn((query: string) => ({
      matches: query.includes('dark') || query.includes('(prefers-color-scheme: dark)'),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      onchange: null,
    })),
  },
  writable: true,
});

// ─── AbortController mock ───
if (typeof globalThis.AbortController === 'undefined') {
  (globalThis as any).AbortController = class {
    signal = { aborted: false, onabort: null };
    abort() { this.signal.aborted = true; }
  };
}
