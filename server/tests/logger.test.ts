import { describe, it, expect } from 'vitest';
import { scrubPII } from '../src/utils/logger';

describe('scrubPII', () => {
  it('masks email addresses', () => {
    const r = scrubPII({ email: 'alice.wonderland@example.com' });
    expect(r.email).toBe('a***@example.com');
  });

  it('masks mainland China mobile numbers', () => {
    const r = scrubPII({ phone: '13800138000' });
    expect(r.phone).toBe('138****8000');
  });

  it('redacts sensitive keys (top-level and nested)', () => {
    const r = scrubPII({ token: 'abc123', apiKey: 'sk-secret', nested: { password: 'hunter2' } });
    expect(r.token).toBe('[REDACTED]');
    expect(r.apiKey).toBe('[REDACTED]');
    expect(r.nested.password).toBe('[REDACTED]');
  });

  it('masks ID card numbers inside free text', () => {
    const r = scrubPII('id: 11010119900307651X end');
    expect(r).toBe('id: 110101********651X end');
  });

  it('recurses into arrays', () => {
    const r = scrubPII([{ email: 'a@b.com' }, { phone: '13912345678' }]);
    expect(r[0].email).toBe('a***@b.com');
    expect(r[1].phone).toBe('139****5678');
  });

  it('preserves non-sensitive fields and primitives', () => {
    const r = scrubPII({ name: '张三', count: 42, active: true });
    expect(r.name).toBe('张三');
    expect(r.count).toBe(42);
    expect(r.active).toBe(true);
  });

  it('exposes only safe fields from Error objects', () => {
    const err = new Error('boom token=abc');
    const r = scrubPII(err) as { name: string; message: string; stack?: string };
    expect(r.name).toBe('Error');
    expect(r.message).toContain('boom');
  });
});
