/**
 * 安全专项测试
 * 覆盖：密码强度策略、输入净化（XSS防护）、文件名净化、租户隔离
 */

import { describe, it, expect } from 'vitest';
import {
  validatePasswordStrength,
  sanitizeString,
  sanitizeObject,
  sanitizeFilename,
  sanitizeRequestBody,
} from '../src/utils/security';
import { authenticateToken, tenantIsolation, authedRouter } from '../src/middleware/auth';
import { errorHandler } from '../src/middleware/errorHandler';
import express from 'express';
import { createServer } from 'http';
import type { Server } from 'http';

describe('密码强度策略', () => {
  it('应拒绝少于8位的密码', () => {
    const r = validatePasswordStrength('Ab1');
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('应拒绝纯数字密码', () => {
    const r = validatePasswordStrength('12345678');
    expect(r.valid).toBe(false);
  });

  it('应拒绝常见弱口令', () => {
    const r = validatePasswordStrength('Password123');
    expect(r.valid).toBe(false);
  });

  it('应拒绝连续序列密码', () => {
    const r = validatePasswordStrength('abcd1234');
    expect(r.valid).toBe(false);
  });

  it('应拒绝重复字符密码', () => {
    const r = validatePasswordStrength('aaaaaaaa');
    expect(r.valid).toBe(false);
  });

  it('应接受符合策略的强密码', () => {
    const r = validatePasswordStrength('MyShop2026!');
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });
});

describe('输入净化（XSS防护）', () => {
  it('应移除HTML标签', () => {
    const dirty = '<script>alert(1)</script>Hello';
    expect(sanitizeString(dirty)).toBe('Hello');
  });

  it('应移除危险协议前缀', () => {
    const dirty = 'javascript:alert(1)';
    expect(sanitizeString(dirty)).not.toContain('javascript:');
  });

  it('应保留正常业务字符（中文/emoji）', () => {
    const normal = '夏季清凉套装 🧊 价格299';
    expect(sanitizeString(normal)).toBe(normal);
  });

  it('应移除\r防止日志注入', () => {
    const dirty = 'admin\r\n[FAKE LOG] something';
    const clean = sanitizeString(dirty);
    expect(clean).not.toContain('\r');
  });

  it('应截断超长输入', () => {
    const long = 'a'.repeat(20000);
    expect(sanitizeString(long).length).toBeLessThanOrEqual(10000);
  });
});

describe('对象递归净化', () => {
  it('应净化嵌套对象中的字符串', () => {
    const input = { name: '<b>test</b>', meta: { desc: '<script>x</script>' }, keep: 123 };
    const out = sanitizeObject(input);
    expect(out.name).toBe('test');
    expect(out.meta.desc).toBe(''); // script 标签及其内容均被移除
    expect(out.keep).toBe(123);
  });

  it('应净化数组中的字符串元素', () => {
    const input = { tags: ['<i>a</i>', '<i>b</i>'] };
    const out = sanitizeObject(input);
    expect(out.tags).toEqual(['a', 'b']);
  });
});

describe('请求体净化中间件辅助', () => {
  it('应跳过密码类字段', () => {
    const body: Record<string, unknown> = {
      username: '<script>x</script>admin',
      password: '<script>should_keep</script>',
      displayName: '<b>张三</b>',
    };
    sanitizeRequestBody(body, new Set(['password']));
    expect(body.username).toBe('admin');
    expect((body.password as string)).toContain('<script>'); // 未净化
    expect(body.displayName).toBe('张三'); // 已净化
  });
});

describe('文件名净化（路径遍历防护）', () => {
  it('应阻止父目录引用', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('..');
  });

  it('应阻止路径分隔符', () => {
    expect(sanitizeFilename('a/b\\c')).not.toContain('/');
    expect(sanitizeFilename('a/b\\c')).not.toContain('\\');
  });
});

describe('鉴权与租户隔离原语（B7）', () => {
  it('authenticateToken 缺令牌应抛 AuthenticationError', () => {
    const req: any = { headers: {} };
    const res: any = {};
    expect(() => authenticateToken(req, res, () => {})).toThrow();
  });

  it('tenantIsolation 应将 user.tenantId 注入 req.tenantId', () => {
    const req: any = { user: { tenantId: 't-fixture' } };
    let called = false;
    tenantIsolation(req, {} as any, () => { called = true; });
    expect(req.tenantId).toBe('t-fixture');
    expect(called).toBe(true);
  });

  it('authedRouter() 生成的路由对未鉴权请求返回 401', async () => {
    const app = express();
    const r = authedRouter();
    r.get('/protected', (_req: any, res: any) => { res.json({ ok: true }); });
    app.use(r);
    app.use(errorHandler);

    const server: Server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as any).port;

    const res = await fetch(`http://127.0.0.1:${port}/protected`);
    expect(res.status).toBe(401);

    server.close();
  });
});

