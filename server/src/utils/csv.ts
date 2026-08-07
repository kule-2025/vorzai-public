/**
 * CSV 解析工具
 * 支持简单 CSV（无引号嵌套、无换行）和带表头的 CSV
 */
import { logger } from '../utils/logger';

export interface CsvParseResult {
  headers: string[];
  rows: Record<string, string>[];
  errors: string[];
}

/**
 * 解析 CSV 字符串
 * @param csvContent CSV 内容
 * @param hasHeader 是否有表头（默认 true）
 */
export function parseCsv(csvContent: string, hasHeader = true): CsvParseResult {
  const errors: string[] = [];
  const lines = csvContent
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0);

  if (lines.length === 0) {
    return { headers: [], rows: [], errors: ['CSV 内容为空'] };
  }

  // 解析表头
  const headers = parseCsvLine(lines[0]);
  if (headers.length === 0) {
    return { headers: [], rows: [], errors: ['无法解析表头'] };
  }

  const rows: Record<string, string>[] = [];

  // 从第2行开始（如果有表头）或第1行（如果没有表头）
  const startIdx = hasHeader ? 1 : 0;
  const effectiveHeaders = hasHeader ? headers : generateHeaders(headers.length);

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;

    const values = parseCsvLine(line);
    if (values.length === 0) {
      errors.push(`第 ${i + 1} 行格式错误`);
      continue;
    }

    const row: Record<string, string> = {};
    for (let j = 0; j < effectiveHeaders.length; j++) {
      row[effectiveHeaders[j]] = values[j] ?? '';
    }
    // 额外列（超出表头数量）
    for (let j = effectiveHeaders.length; j < values.length; j++) {
      row[`_extra_${j}`] = values[j];
    }
    rows.push(row);
  }

  logger.info('csv', `Parsed CSV: ${rows.length} rows, ${headers.length} columns`, {
    headers,
    rowCount: rows.length,
    errorCount: errors.length,
  });

  return { headers, rows, errors };
}

/**
 * 解析单行 CSV
 * 支持简单的引号包裹和转义
 */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
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
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * 生成默认表头
 */
function generateHeaders(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `column_${i + 1}`);
}

/**
 * 将数据转换为 CSV 字符串
 */
export function toCsv(rows: Record<string, string>[], headers?: string[]): string {
  const cols = headers || (rows.length > 0 ? Object.keys(rows[0]) : []);
  if (cols.length === 0) return '';

  const lines: string[] = [];
  lines.push(cols.map(col => `"${col}"`).join(','));
  for (const row of rows) {
    lines.push(cols.map(col => {
      const val = row[col] ?? '';
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(','));
  }
  return lines.join('\n');
}
