/**
 * 集成测试辅助函数
 */

import http from 'http';
import { AddressInfo } from 'net';
import fs from 'fs';

/**
 * 删除测试数据库及其 WAL 附属文件。
 *
 * 只删主库是不够的：SQLite 处于 WAL 模式时，数据可能还留在 `-wal` 里。
 * Windows 上主库被删、`-wal` 残留时，下一轮 initDatabase 会把旧 WAL 回放回来，
 * 让上一轮的测试数据「复活」，造成基于固定值断言的偶发失败。
 */
export function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(`${dbPath}${suffix}`); } catch { /* 文件不存在或被占用都不影响测试 */ }
  }
}

export interface TestTenant {
  tenantId: string;
  userId: string;
  token: string;
  username: string;
  password: string;
}

export function makeRequest(
  server: http.Server,
  port: number,
  method: string,
  path: string,
  token?: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data));

    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let parsed: any = null;
          try { parsed = JSON.parse(raw); } catch { /* ignore */ }
          resolve({ status: res.statusCode || 0, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

export async function createTenant(server: http.Server, port: number): Promise<TestTenant> {
  const rand = Math.random().toString(36).slice(2, 9);
  const username = `testuser_${rand}`;
  const password = 'TestShop2026!';

  // 租户名带随机后缀，保证 slug 全局唯一：authService 用 tenantName 派生 slug，
  // 固定名「测试租户」在复用测试库时会触发 UNIQUE(tenants.slug) 冲突。
  const res = await makeRequest(server, port, 'POST', '/api/auth/register', undefined, {
    username,
    password,
    displayName: '测试用户',
    tenantName: `测试租户_${rand}`,
  });

  if (res.status !== 201) {
    throw new Error(`注册失败: ${res.status} ${JSON.stringify(res.body)}`);
  }

  return {
    tenantId: res.body.data.user.tenantId,
    userId: res.body.data.user.id,
    token: res.body.data.tokens.accessToken,
    username,
    password,
  };
}
