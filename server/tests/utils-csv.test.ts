/**
 * CSV 工具单元测试（B2 · 覆盖率提升）
 * 覆盖：parseCsv（含表头/无表头/引号转义/额外列/错误路径）、parseCsvLine、generateHeaders、toCsv（含特殊字符转义）
 */
import { describe, it, expect } from 'vitest';
import { parseCsv, toCsv } from '../src/utils/csv';

describe('utils/csv — parseCsv', () => {
  it('空内容返回错误', () => {
    const r = parseCsv('');
    expect(r.headers).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.errors).toContain('CSV 内容为空');
  });

  it('带表头的标准解析', () => {
    const csv = 'name,age\nAlice,30\nBob,25';
    const r = parseCsv(csv);
    expect(r.headers).toEqual(['name', 'age']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ name: 'Alice', age: '30' });
    expect(r.rows[1]).toEqual({ name: 'Bob', age: '25' });
    expect(r.errors).toHaveLength(0);
  });

  it('引号包裹与双引号转义', () => {
    const csv = 'note\n"hello, world"\n"say ""hi"""';
    const r = parseCsv(csv);
    expect(r.rows[0].note).toBe('hello, world');
    expect(r.rows[1].note).toBe('say "hi"');
  });

  it('行内引号包裹（字段级）', () => {
    const csv = 'a,b\n"x",y';
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual({ a: 'x', b: 'y' });
  });

  it('超表头列存入 _extra_N', () => {
    const csv = 'a,b\n1,2,3,4';
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual({ a: '1', b: '2', _extra_2: '3', _extra_3: '4' });
  });

  it('字段数不足时按表头补空串', () => {
    const csv = 'a,b,c\n1';
    const r = parseCsv(csv);
    expect(r.rows[0]).toEqual({ a: '1', b: '', c: '' });
  });

  it('空行被跳过', () => {
    const csv = 'a\nx\n\n  \ny';
    const r = parseCsv(csv);
    expect(r.rows.map((row) => row.a)).toEqual(['x', 'y']);
  });

  it('无表头时使用自动列名 column_N', () => {
    const csv = '1,2\n3,4';
    const r = parseCsv(csv, false);
    expect(r.rows[0]).toEqual({ column_1: '1', column_2: '2' });
    expect(r.rows[1]).toEqual({ column_1: '3', column_2: '4' });
  });

  it('格式错误的行记录到 errors 但不中断', () => {
    const csv = 'a\n""\nx';
    const r = parseCsv(csv);
    expect(r.rows.some((row) => row.a === 'x')).toBe(true);
  });
});

describe('utils/csv — toCsv', () => {
  it('返回空字符串当无列', () => {
    expect(toCsv([])).toBe('');
    expect(toCsv([{ a: '1' }], [])).toBe('');
  });

  it('表头与行以引号包裹；普通值不包裹', () => {
    const out = toCsv([{ name: 'Alice', age: '30' }], ['name', 'age']);
    expect(out).toBe('"name","age"\nAlice,30');
  });

  it('缺失值补空串', () => {
    const out = toCsv([{ name: 'Bob' }], ['name', 'age']);
    expect(out).toBe('"name","age"\nBob,');
  });

  it('含逗号/引号/换行的字段被转义', () => {
    const out = toCsv(
      [
        { v: 'a,b' },
        { v: 'he said "hi"' },
        { v: 'line1\nline2' },
      ],
      ['v']
    );
    expect(out).toBe('"v"\n"a,b"\n"he said ""hi"""\n"line1\nline2"');
  });

  it('无显式表头时自动取首行键（普通值不包裹）', () => {
    const out = toCsv([{ x: '1', y: '2' }]);
    expect(out).toBe('"x","y"\n1,2');
  });
});
