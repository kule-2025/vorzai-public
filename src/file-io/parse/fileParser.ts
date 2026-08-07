/**
 * 文件格式自动识别 + 解析引擎
 * 支持 JSON / JSONL / CSV / TSV / TXT / XML / YAML
 * 大文件采用 ReadableStream + 分片读取
 */

import {
  SupportedFormat, ParseResult, ParseWarning, ImportError,
  ChunkConfig, FileMeta, FORMAT_EXT, FORMAT_MIME,
} from '@file-io/types';

// ─── 文件大小格式 ───

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// ─── 格式自动识别 ───

export function detectFormat(file: File): SupportedFormat {
  const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
  // 1. 扩展名优先
  if (ext && FORMAT_EXT[ext]) return FORMAT_EXT[ext];
  // 2. MIME 类型
  if (file.type && FORMAT_MIME[file.type]) return FORMAT_MIME[file.type];
  // 3. 内容嗅探（小文件）
  return 'unknown';
}

/** 增强嗅探：尝试读取文件头部字节来判断 */
export async function sniffFormat(file: File): Promise<SupportedFormat> {
  const chunk = await file.slice(0, 2048).arrayBuffer();
  const text = new TextDecoder().decode(chunk);

  // JSON 特征
  if (/^\s*[\[\{]/.test(text)) return 'json';
  // JSON Lines（每行独立 JSON）
  if (text.split('\n').filter((l) => /^\s*[\{\[]/.test(l)).length >= 2) return 'jsonl';
  // CSV（含逗号分隔）
  if (text.includes(',') && (text.includes('\r') || text.includes('\n'))) return 'csv';
  // TSV
  if (text.includes('\t') && (text.includes('\r') || text.includes('\n'))) return 'tsv';
  // XML
  if (/<\?xml/i.test(text) || /^<\w+/i.test(text.trim())) return 'xml';
  // YAML
  if (/^[-:|>]\s/m.test(text)) return 'yaml';
  // PDF magic number
  if (text.startsWith('%PDF')) return 'pdf';
  return 'unknown';
}

// ─── 通用文件读取 ───

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

// ─── CSV 解析 ───

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
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            current += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === delimiter) {
          row.push(current);
          current = '';
        } else {
          current += ch;
        }
      }
    }
    row.push(current);
    rows.push(row);
  }

  return { headers: rows[0], rows: rows.slice(1) };
}

// ─── JSON 解析 ───

function tryParseJSON(text: string): { data: unknown[]; isJsonl: boolean } | { error: string } {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data)) return { data, isJsonl: false };
    if (typeof data === 'object' && data !== null) return { data: [data], isJsonl: false };
    return { error: 'JSON 格式无效：非对象或数组' };
  } catch {
    return { error: 'JSON 解析失败' };
  }
}

// ─── JSONL 解析 ───

function parseJSONL(text: string): { data: unknown[]; warnings: ParseWarning[] } {
  const lines = text.split('\n').filter((l) => l.trim());
  const data: unknown[] = [];
  const warnings: ParseWarning[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      data.push(JSON.parse(line));
    } catch {
      warnings.push({ level: 'warn', message: `第 ${i + 1} 行 JSON 解析失败: ${line.substring(0, 80)}...`, index: i });
    }
  }

  return { data, warnings };
}

// ─── XML 解析 ───

function parseXML(text: string): { data: unknown[]; warnings: ParseWarning[] } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) return { data: [], warnings: [{ level: 'warn', message: 'XML 解析失败：结构错误' }] };

    // 提取根元素的直接子元素
    const root = doc.documentElement;
    const children = Array.from(root.children);
    const data = children.map((child) => {
      const obj: Record<string, string> = {};
      // 属性
      Array.from(child.attributes).forEach((attr) => {
        obj[attr.name] = attr.value;
      });
      // 子节点文本
      Array.from(child.children).forEach((sub) => {
        obj[sub.tagName] = sub.textContent || '';
      });
      return obj;
    });

    return { data, warnings: [] };
  } catch {
    return { data: [], warnings: [{ level: 'warn', message: 'XML 解析异常' }] };
  }
}

// ─── YAML 解析 ───

function parseYAML(text: string): { data: unknown[]; warnings: ParseWarning[] } {
  // 简单 YAML 解析：支持 list 和 dict
  try {
    const lines = text.split('\n');
    const items: unknown[] = [];
    let current: Record<string, unknown> | null = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      if (trimmed.startsWith('- ')) {
        if (current) items.push(current);
        const inner = trimmed.substring(2).trim();
        // 行内 key: value
        if (inner.includes(': ')) {
          const [key, ...rest] = inner.split(': ');
          current = { [key]: rest.join(': ') };
        } else {
          current = { value: inner };
        }
      } else if (current && trimmed.includes(': ')) {
        const [key, ...rest] = trimmed.split(': ');
        current[key] = rest.join(': ');
      }
    }
    if (current) items.push(current);

    return { data: items, warnings: [] };
  } catch {
    return { data: [], warnings: [{ level: 'warn', message: 'YAML 解析失败（当前使用简化解析器）' }] };
  }
}

// ─── 主解析入口 ───

export async function parseFile(
  file: File,
  opts?: { chunkCallback?: (chunk: unknown[], index: number) => Promise<void> | void; chunkSize?: number }
): Promise<ParseResult> {
  const format = await sniffFormat(file);
  const warnings: ParseWarning[] = [];

  if (format === 'unknown') {
    return {
      format: 'unknown',
      data: [],
      headers: [],
      totalRows: 0,
      encoding: 'utf-8',
      warnings: [{ level: 'warn', message: '无法识别文件格式，请检查文件扩展名' }],
    };
  }

  // 大文件检测（> 5MB 使用分片）
  const isLargeFile = file.size > 5 * 1024 * 1024;
  const chunkSize = opts?.chunkSize || 5000;
  const cb = opts?.chunkCallback;

  if (isLargeFile && cb) {
    return parseLargeFile(file, format, chunkSize, cb);
  }

  // 小文件：一次性读取
  const text = await readFileAsText(file);

  switch (format) {
    case 'json': {
      const result = tryParseJSON(text);
      if ('error' in result) {
        warnings.push({ level: 'warn', message: result.error });
        return { format, data: [], headers: [], totalRows: 0, encoding: 'utf-8', warnings };
      }
      const headers = result.data.length > 0 ? Object.keys(result.data[0] as object) : [];
      return { format, data: result.data as unknown[], headers, totalRows: result.data.length, encoding: 'utf-8', warnings };
    }

    case 'jsonl': {
      const { data, warnings: wl } = parseJSONL(text);
      warnings.push(...wl);
      const headers = data.length > 0 ? Object.keys(data[0] as object) : [];
      return { format, data, headers, totalRows: data.length, encoding: 'utf-8', warnings };
    }

    case 'csv': {
      const { headers, rows } = parseCSV(text, ',');
      const data = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      return { format, data, headers, totalRows: rows.length, encoding: 'utf-8', warnings };
    }

    case 'tsv': {
      const { headers, rows } = parseCSV(text, '\t');
      const data = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      return { format, data, headers, totalRows: rows.length, encoding: 'utf-8', warnings };
    }

    case 'txt': {
      const lines = text.split('\n').filter((l) => l.trim());
      return { format, data: lines, headers: ['line'], totalRows: lines.length, encoding: 'utf-8', warnings };
    }

    case 'xml': {
      const { data, warnings: wl } = parseXML(text);
      warnings.push(...wl);
      const headers = data.length > 0 ? Object.keys(data[0] as object) : [];
      return { format, data, headers, totalRows: data.length, encoding: 'utf-8', warnings };
    }

    case 'yaml': {
      const { data, warnings: wl } = parseYAML(text);
      warnings.push(...wl);
      const headers = data.length > 0 ? Object.keys(data[0] as object) : [];
      return { format, data, headers, totalRows: data.length, encoding: 'utf-8', warnings };
    }

    case 'pdf': {
      warnings.push({ level: 'warn', message: 'PDF 格式暂不支持内容解析，仅识别元数据' });
      return { format, data: [], headers: [], totalRows: 0, encoding: 'utf-8', warnings };
    }

    case 'xlsx':
    case 'xls': {
      warnings.push({ level: 'warn', message: 'Excel 格式需要额外依赖 (xlsx)，当前使用 CSV 兜底' });
      // 兜底：尝试 CSV 解析
      const { headers, rows } = parseCSV(text, ',');
      const data = rows.map((row) => {
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
        return obj;
      });
      return { format: 'csv', data, headers, totalRows: rows.length, encoding: 'utf-8', warnings };
    }

    default:
      return { format: 'unknown', data: [], headers: [], totalRows: 0, encoding: 'utf-8', warnings };
  }
}

// ─── 大文件分片解析 ───

async function parseLargeFile(
  file: File,
  format: SupportedFormat,
  chunkSize: number,
  chunkCallback: (chunk: unknown[], index: number) => Promise<void> | void
): Promise<ParseResult> {
  const warnings: ParseWarning[] = [];

  if (format === 'csv' || format === 'tsv') {
    const delimiter = format === 'tsv' ? '\t' : ',';
    const { headers, totalRows, allWarnings } = await parseCSVChunked(file, delimiter, chunkSize, chunkCallback);
    warnings.push(...allWarnings);
    return { format, data: [], headers, totalRows, encoding: 'utf-8', warnings };
  }

  if (format === 'jsonl') {
    const { totalRows, allWarnings } = await parseJSONLChunked(file, chunkSize, chunkCallback);
    warnings.push(...allWarnings);
    return { format, data: [], headers: [], totalRows, encoding: 'utf-8', warnings };
  }

  // JSON/XML 等其他格式：降级为小文件处理
  warnings.push({ level: 'warn', message: `大文件 ${format} 格式不支持流式解析，降级为一次性读取` });
  const text = await readFileAsText(file);
  const smallResult = await parseFile({ name: file.name, type: file.type, size: file.size, lastModified: file.lastModified, slice: file.slice.bind(file) } as File);
  return smallResult;
}

// ─── CSV 分片解析 ───

async function parseCSVChunked(
  file: File,
  delimiter: string,
  chunkSize: number,
  chunkCallback: (chunk: unknown[], index: number) => Promise<void> | void
): Promise<{ headers: string[]; totalRows: number; allWarnings: ParseWarning[] }> {
  const text = await readFileAsText(file);
  const lines = text.split('\n').filter((l) => l.trim());
  const headers = lines[0].split(delimiter).map((h) => h.trim().replace(/^"|"$/g, ''));
  const warnings: ParseWarning[] = [];
  let chunk: unknown[] = [];
  let chunkIndex = 0;
  let totalRows = 0;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalRows++;
    const row = line.split(delimiter).map((v) => v.trim().replace(/^"|"$/g, ''));
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = row[idx] ?? ''; });
    chunk.push(obj);

    if (chunk.length >= chunkSize) {
      await chunkCallback(chunk, chunkIndex++);
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    await chunkCallback(chunk, chunkIndex);
  }

  return { headers, totalRows, allWarnings: warnings };
}

// ─── JSONL 分片解析 ───

async function parseJSONLChunked(
  file: File,
  chunkSize: number,
  chunkCallback: (chunk: unknown[], index: number) => Promise<void> | void
): Promise<{ totalRows: number; allWarnings: ParseWarning[] }> {
  const text = await readFileAsText(file);
  const lines = text.split('\n').filter((l) => l.trim());
  const warnings: ParseWarning[] = [];
  let chunk: unknown[] = [];
  let chunkIndex = 0;
  let totalRows = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    totalRows++;
    try {
      chunk.push(JSON.parse(line));
    } catch {
      warnings.push({ level: 'warn', message: `第 ${i + 1} 行解析失败`, index: i });
    }

    if (chunk.length >= chunkSize) {
      await chunkCallback(chunk, chunkIndex++);
      chunk = [];
    }
  }
  if (chunk.length > 0) {
    await chunkCallback(chunk, chunkIndex);
  }

  return { totalRows, allWarnings: warnings };
}

// ─── 数据校验 ───

export interface ValidationRule {
  field: string;
  type?: 'string' | 'number' | 'boolean' | 'email' | 'url';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  min?: number;
  max?: number;
  enum?: string[];
}

export function validateRecords(
  records: unknown[],
  rules: ValidationRule[],
  headers: string[]
): ImportError[] {
  const errors: ImportError[] = [];

  for (let i = 0; i < records.length; i++) {
    const record = records[i] as Record<string, unknown>;
    for (const rule of rules) {
      const value = record[rule.field];

      // 必填检查
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push({
          file: '',
          index: i,
          message: `字段 "${rule.field}" 为必填项`,
          severity: 'error',
          field: rule.field,
        });
        continue;
      }

      if (value === undefined || value === null) continue;

      // 类型检查
      if (rule.type) {
        switch (rule.type) {
          case 'string':
            if (typeof value !== 'string') {
              errors.push({ file: '', index: i, message: `"${rule.field}" 应为字符串`, severity: 'error', field: rule.field, value });
            }
            break;
          case 'number':
            if (typeof value !== 'number' || isNaN(value)) {
              errors.push({ file: '', index: i, message: `"${rule.field}" 应为数字`, severity: 'error', field: rule.field, value });
            }
            break;
          case 'boolean':
            if (typeof value !== 'boolean') {
              errors.push({ file: '', index: i, message: `"${rule.field}" 应为布尔值`, severity: 'error', field: rule.field, value });
            }
            break;
          case 'email':
            if (typeof value === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
              errors.push({ file: '', index: i, message: `"${rule.field}" 邮箱格式无效`, severity: 'warn', field: rule.field, value });
            }
            break;
          case 'url':
            if (typeof value === 'string' && !/^https?:\/\//.test(value)) {
              errors.push({ file: '', index: i, message: `"${rule.field}" URL 格式无效`, severity: 'warn', field: rule.field, value });
            }
            break;
        }
      }

      // 长度约束
      if (rule.minLength && typeof value === 'string' && value.length < rule.minLength) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 长度不足 ${rule.minLength}`, severity: 'warn', field: rule.field });
      }
      if (rule.maxLength && typeof value === 'string' && value.length > rule.maxLength) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 超过最大长度 ${rule.maxLength}`, severity: 'warn', field: rule.field });
      }

      // 范围约束
      if (rule.min !== undefined && typeof value === 'number' && value < rule.min) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 小于最小值 ${rule.min}`, severity: 'warn', field: rule.field, value });
      }
      if (rule.max !== undefined && typeof value === 'number' && value > rule.max) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 大于最大值 ${rule.max}`, severity: 'warn', field: rule.field, value });
      }

      // 枚举约束
      if (rule.enum && typeof value === 'string' && !rule.enum.includes(value)) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 值不在允许范围 ${rule.enum.join('/')}`, severity: 'warn', field: rule.field, value });
      }

      // 正则约束
      if (rule.pattern && typeof value === 'string' && !rule.pattern.test(value)) {
        errors.push({ file: '', index: i, message: `"${rule.field}" 不符合格式要求`, severity: 'warn', field: rule.field, value });
      }
    }
  }

  return errors;
}
