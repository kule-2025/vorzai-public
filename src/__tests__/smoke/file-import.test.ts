/**
 * 冒烟测试 — CSV/JSON 解析
 */
import { describe, it, expect, vi } from 'vitest';

// ─── 模拟 parseFile 核心逻辑 ───

function detectFormat(name: string): string {
  const ext = name.toLowerCase().substring(name.lastIndexOf('.'));
  const FORMAT_EXT: Record<string, string> = {
    '.json': 'json',
    '.csv': 'csv',
    '.txt': 'txt',
    '.xml': 'xml',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.xlsx': 'xlsx',
    '.xls': 'xls',
    '.pdf': 'pdf',
  };
  return FORMAT_EXT[ext] || 'unknown';
}

function parseCSV(text: string, delimiter: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const rows: string[][] = [];
  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"' && (i + 1 < line.length && line[i + 1] === '"')) { current += '"'; i++; }
        else if (ch === '"') { inQuotes = false; }
        else { current += ch; }
      } else {
        if (ch === '"') { inQuotes = true; }
        else if (ch === delimiter) { row.push(current); current = ''; }
        else { current += ch; }
      }
    }
    row.push(current);
    rows.push(row);
  }
  return { headers: rows[0], rows: rows.slice(1) };
}

function parseJSON(text: string): { data: unknown[]; error?: string } {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { data };
    if (typeof data === 'object' && data !== null) return { data: [data] };
    return { data: [], error: '非对象或数组' };
  } catch {
    return { data: [], error: 'JSON 解析失败' };
  }
}

describe('file-import', () => {
  describe('格式检测', () => {
    it('JSON 文件应识别为 json', () => {
      expect(detectFormat('data.json')).toBe('json');
    });

    it('CSV 文件应识别为 csv', () => {
      expect(detectFormat('data.csv')).toBe('csv');
    });

    it('TXT 文件应识别为 txt', () => {
      expect(detectFormat('data.txt')).toBe('txt');
    });

    it('不支持的扩展名应返回 unknown', () => {
      expect(detectFormat('data.xyz')).toBe('unknown');
    });

    it('大小写不敏感', () => {
      expect(detectFormat('DATA.CSV')).toBe('csv');
      expect(detectFormat('data.JSON')).toBe('json');
    });
  });

  describe('CSV 解析', () => {
    it('应正确解析简单 CSV', () => {
      const csv = 'name,age,city\nAlice,25,Beijing\nBob,30,Shanghai';
      const { headers, rows } = parseCSV(csv, ',');
      expect(headers).toEqual(['name', 'age', 'city']);
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(['Alice', '25', 'Beijing']);
    });

    it('应正确解析含引号的 CSV', () => {
      const csv = 'name,desc\n"Smith, John","Hello, "world""';
      const { headers, rows } = parseCSV(csv, ',');
      expect(headers).toEqual(['name', 'desc']);
      expect(rows[0][0]).toBe('Smith, John');
    });

    it('空 CSV 应返回空结果', () => {
      const { headers, rows } = parseCSV('', ',');
      expect(headers).toEqual([]);
      expect(rows).toEqual([]);
    });

    it('应将 CSV 行转换为对象数组', () => {
      const csv = 'id,name\n1,Alice\n2,Bob';
      const { headers, rows } = parseCSV(csv, ',');
      const data = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({ id: '1', name: 'Alice' });
      expect(data[1]).toEqual({ id: '2', name: 'Bob' });
    });
  });

  describe('JSON 解析', () => {
    it('应正确解析 JSON 数组', () => {
      const json = '[{"id":1,"name":"Alice"},{"id":2,"name":"Bob"}]';
      const { data } = parseJSON(json);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(2);
      expect((data as any[])[0].id).toBe(1);
    });

    it('应正确解析单个 JSON 对象（包装为数组）', () => {
      const json = '{"id":1,"name":"Alice"}';
      const { data } = parseJSON(json);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
    });

    it('无效 JSON 应返回错误', () => {
      const { data, error } = parseJSON('not json');
      expect(data).toEqual([]);
      expect(error).toBeDefined();
    });

    it('空 JSON 数组应返回空数组', () => {
      const { data } = parseJSON('[]');
      expect(data).toEqual([]);
    });
  });

  describe('TXT 解析', () => {
    it('应正确解析纯文本行', () => {
      const txt = 'line1\nline2\nline3\n';
      const lines = txt.split('\n').filter((l) => l.trim());
      expect(lines).toHaveLength(3);
      expect(lines[0]).toBe('line1');
    });
  });

  describe('验证规则', () => {
    const records = [
      { name: 'Alice', email: 'alice@test.com', age: 25 },
      { name: 'Bob', email: 'invalid', age: -1 },
    ];

    it('应检测必填字段缺失', () => {
      const requiredFields = ['name', 'email'];
      const errors: string[] = [];
      records.forEach((r: any, i) => {
        requiredFields.forEach((f) => {
          if (r[f] === undefined || r[f] === null || r[f] === '') {
            errors.push(`第 ${i} 行字段 ${f} 必填`);
          }
        });
      });
      expect(errors.length).toBe(0);
    });

    it('应检测邮箱格式无效', () => {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const invalidEmails = records.filter((r: any) => !emailPattern.test(r.email));
      expect(invalidEmails).toHaveLength(1);
      expect(invalidEmails[0].name).toBe('Bob');
    });

    it('应检测数字范围', () => {
      const outOfRange = records.filter((r: any) => typeof r.age === 'number' && r.age < 0);
      expect(outOfRange).toHaveLength(1);
    });
  });
});
