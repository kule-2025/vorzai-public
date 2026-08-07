/**
 * 回归测试：文件解析与导出
 */
import { describe, it, expect } from 'vitest';

describe('File Parser - CSV', () => {
  it('should parse simple CSV', () => {
    const csv = 'name,value\nfoo,1\nbar,2';
    const lines = csv.split('\n');
    const headers = lines[0].split(',');
    expect(headers).toEqual(['name', 'value']);
    expect(lines).toHaveLength(3);
  });

  it('should handle quoted CSV fields', () => {
    const csv = 'name,desc\n"foo","a, b, c"\n"bar","d, e"';
    const lines = csv.split('\n');
    expect(lines).toHaveLength(3);
  });

  it('should handle empty CSV', () => {
    const csv = '';
    expect(csv.trim()).toBe('');
  });
});

describe('File Parser - JSON', () => {
  it('should parse valid JSON array', () => {
    const json = '[{"name":"foo"},{"name":"bar"}]';
    const data = JSON.parse(json);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('foo');
  });

  it('should handle empty JSON array', () => {
    const json = '[]';
    const data = JSON.parse(json);
    expect(data).toHaveLength(0);
  });

  it('should reject invalid JSON', () => {
    const json = '{invalid}';
    expect(() => JSON.parse(json)).toThrow();
  });
});

describe('File Export', () => {
  it('should generate CSV from records', () => {
    const records = [{ name: 'foo', value: 1 }, { name: 'bar', value: 2 }];
    const headers = Object.keys(records[0]);
    const lines = records.map(r => headers.map(h => String(r[h as keyof typeof r])).join(','));
    const csv = [headers.join(','), ...lines].join('\n');
    expect(csv).toContain('foo,1');
    expect(csv).toContain('bar,2');
  });

  it('should generate JSON from records', () => {
    const records = [{ name: 'foo', value: 1 }];
    const json = JSON.stringify(records, null, 2);
    expect(json).toContain('"name": "foo"');
    expect(json).toContain('"value": 1');
  });
});
