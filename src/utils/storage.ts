/**
 * IndexedDB 持久化存储层
 * 支持对象级 get/set/delete，批量操作，JSON 数据，自动初始化
 */

const DB_NAME = 'vorzai-ecommerce-hrms';
const DB_VERSION = 1;
const STORE_NAME = 'hrms';

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
  return dbPromise;
}

export interface StorageMeta {
  updatedAt: string;
}

export async function getItem<T>(key: string): Promise<T | null> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    return localStorage.getItem(key) ? JSON.parse(localStorage.getItem(key)!) : null;
  }
}

/** E-001: localStorage 大对象分片写入（防止主线程阻塞） */
const CHUNK_SIZE_BYTES = 512 * 1024; // 512KB 分片

function writeChunkedJSON(key: string, value: unknown, onDone: () => void, onError: (err: Error) => void): void {
  const str = JSON.stringify(value);
  const bytes = new TextEncoder().encode(str).length;
  if (bytes <= CHUNK_SIZE_BYTES) {
    try { localStorage.setItem(key, str); onDone(); }
    catch (e) { onError(e as Error); }
    return;
  }

  const chunks = Math.ceil(bytes / CHUNK_SIZE_BYTES);
  localStorage.setItem(`${key}.__meta`, JSON.stringify({ chunks, totalBytes: bytes }));

  const text = str;
  let idx = 0;
  function writeNext(): void {
    const slice = text.slice(idx * CHUNK_SIZE_BYTES, (idx + 1) * CHUNK_SIZE_BYTES);
    try { localStorage.setItem(`${key}.__chunk_${idx}`, slice); }
    catch (e) { onError(e as Error); return; }
    idx++;
    if (idx >= chunks) onDone();
    else setTimeout(writeNext, 0);
  }
  writeNext();
}

export async function setItem<T>(key: string, value: T): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    // E-001: 大对象走分片写入，避免主线程阻塞
    writeChunkedJSON(key, value, () => {}, () => {});
  }
}

export async function delItem(key: string): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    localStorage.removeItem(key);
  }
}

export async function clearAll(): Promise<void> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch (e) {
    localStorage.clear();
  }
}

/** 导出所有数据为 JSON */
export async function exportAll(): Promise<string> {
  try {
    const result = await exportDataWithKeys();
    return JSON.stringify(result, null, 2);
  } catch (e) {
    // Fallback to localStorage
    const data: Record<string, unknown> = {};
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        try {
          data[key] = JSON.parse(localStorage.getItem(key) || 'null');
        } catch {
          data[key] = localStorage.getItem(key);
        }
      }
    }
    return JSON.stringify(data, null, 2);
  }
}

/** 导出所有键值对为 JSON（带 key 名） */
export async function exportDataWithKeys(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const keysRequest = store.getAllKeys();
      keysRequest.onsuccess = async () => {
        const keys = keysRequest.result as string[];
        for (const key of keys) {
          result[key] = await getItem(key);
        }
        resolve(result);
      };
      keysRequest.onerror = () => reject(keysRequest.error);
    });
  } catch {
    // Fallback: localStorage
    for (const key in localStorage) {
      if (localStorage.hasOwnProperty(key)) {
        result[key] = localStorage.getItem(key);
      }
    }
    return result;
  }
}

/** 从 JSON 导入数据 */
export async function importData(data: Record<string, unknown>): Promise<void> {
  for (const [key, value] of Object.entries(data)) {
    await setItem(key, value);
  }
}

/** 列出所有存储的 key */
export async function listKeys(): Promise<string[]> {
  try {
    const db = await getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result as string[]);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return Object.keys(localStorage);
  }
}
