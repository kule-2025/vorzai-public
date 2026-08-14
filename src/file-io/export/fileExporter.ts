/**
 * 多格式数据导出引擎
 * 支持 JSON / CSV / XLSX / TXT 导出
 * 大文件分片生成 Blob，字段映射 + 编码配置
 */

import {
  ExportFormat, FieldMapping, ExportConfig, ExportResult,
  BatchExportConfig,
} from '@file-io/types';

// ─── 编码处理 ───

const UTF8_BOM = '\uFEFF';
const GBK_MARKER = '\u0000'; // GBK 文件头部空字符标记

function addEncodingBOM(format: 'utf-8' | 'utf-8-bom' | 'gbk'): string {
  if (format === 'utf-8-bom') return UTF8_BOM;
  return '';
}

// ─── 字段映射 ───

function mapRecord(record: unknown, mapping: FieldMapping[]): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const m of mapping) {
    const value = (record as Record<string, unknown>)[m.sourceField];
    mapped[m.targetField] = value !== undefined ? value : m.defaultValue;
  }
  return mapped;
}

// ─── CSV 导出 ───

function recordToCSVLine(record: Record<string, unknown>, headers: string[]): string {
  return headers
    .map((h) => {
      const val = record[h] ?? '';
      const str = String(val);
      // 含逗号/换行/引号的字段需要加引号包裹
      if (str.includes(',') || str.includes('\n') || str.includes('"') || str.includes('\r')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    })
    .join(',');
}

function exportToCSV(
  records: unknown[],
  config: ExportConfig
): { text: string; totalRows: number } {
  const bom = addEncodingBOM(config.encoding);
  const headers = config.fieldMapping.map((m) => m.targetField);
  const lines = ['']; // 第一行留空给 BOM

  if (config.includeHeaders) {
    lines[0] += headers.join(',');
  }

  let totalRows = 0;
  for (const record of records) {
    const mapped = mapRecord(record, config.fieldMapping);
    lines.push(recordToCSVLine(mapped, headers));
    totalRows++;
  }

  return { text: bom + lines.join('\n'), totalRows };
}

// ─── JSON 导出 ───

function exportToJSON(
  records: unknown[],
  config: ExportConfig
): { text: string; totalRows: number } {
  const mappedRecords = records.map((r) => mapRecord(r, config.fieldMapping));
  const indent = 2;
  return { text: JSON.stringify(mappedRecords, null, indent), totalRows: mappedRecords.length };
}

// ─── JSON Lines 导出 ───

function exportToJSONL(
  records: unknown[],
  config: ExportConfig
): { text: string; totalRows: number } {
  const lines = records.map((r) => {
    const mapped = mapRecord(r, config.fieldMapping);
    return JSON.stringify(mapped);
  });
  return { text: lines.join('\n'), totalRows: lines.length };
}

// ─── TXT 导出 ───

function exportToTXT(
  records: unknown[],
  config: ExportConfig
): { text: string; totalRows: number } {
  const lines: string[] = [];
  let totalRows = 0;

  for (const record of records) {
    const mapped = mapRecord(record, config.fieldMapping);
    const line = config.fieldMapping
      .map((m) => `${m.targetField}: ${mapped[m.targetField] ?? '(空)'}`)
      .join(' | ');
    lines.push(line);
    totalRows++;
  }

  const bom = addEncodingBOM(config.encoding);
  return { text: bom + lines.join('\n'), totalRows };
}

// ─── XLSX 导出（轻量实现：生成简单的 HTML table + 转为 .xls） ───

function exportToXLSX(
  records: unknown[],
  config: ExportConfig
): { blob: Blob; totalRows: number } {
  const headers = config.fieldMapping.map((m) => m.targetField);
  const rows = records.map((r) => mapRecord(r, config.fieldMapping));

  // 生成 HTML Table 内容，浏览器可保存为 .xls
  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office"
          xmlns:x="urn:schemas-microsoft-com:office:excel"
          xmlns="http://www.w3.org/TR/REC-html40">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/>
      <style>
        td { padding: 4px 8px; border: 1px solid #ddd; font-family: "Microsoft YaHei"; font-size: 12px; }
        th { padding: 6px 8px; border: 1px solid #999; background: #f5f5f5; font-weight: 700; font-family: "Microsoft YaHei"; font-size: 12px; }
      </style>
    </head>
    <body>
      <table>
        <tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr>
        ${rows
          .map(
            (r) =>
              `<tr>${headers
                .map((h) => `<td>${String(r[h] ?? '')}</td>`)
                .join('')}</tr>`
          )
          .join('')}
      </table>
    </body>
    </html>
  `;

  return { blob: new Blob([html], { type: 'application/vnd.ms-excel' }), totalRows: rows.length };
}

// ─── 大文件分片导出（生成多个 Blob，用户可分别下载） ───

async function exportInChunks(
  dataProvider: (startIndex: number, size: number) => Promise<unknown[]>,
  totalRows: number,
  config: ExportConfig,
  chunkSize: number
): Promise<ExportResult[]> {
  const chunks: ExportResult[] = [];
  const chunksCount = Math.ceil(totalRows / chunkSize);

  for (let i = 0; i < chunksCount; i++) {
    const start = i * chunkSize;
    const end = Math.min(start + chunkSize, totalRows);
    const records = await dataProvider(start, end - start);
    const chunkConfig = { ...config, filename: `${config.filename}-chunk-${i + 1}` };

    const result = await exportBatch(records, chunkConfig);
    chunks.push(result);
  }

  return chunks;
}

// ─── 主导出入口 ───

export async function exportBatch(
  records: unknown[],
  config: ExportConfig
): Promise<ExportResult> {
  const start = performance.now();

  let blob: Blob;
  let totalRows = records.length;
  let totalChunks = 1;

  switch (config.format) {
    case 'json': {
      const { text, totalRows: t } = exportToJSON(records, config);
      blob = new Blob([text], { type: 'application/json; charset=utf-8' });
      totalRows = t;
      break;
    }

    case 'csv': {
      const { text, totalRows: t } = exportToCSV(records, config);
      blob = new Blob([text], { type: 'text/csv; charset=utf-8' });
      totalRows = t;
      break;
    }

    case 'xlsx': {
      const { blob: b, totalRows: t } = exportToXLSX(records, config);
      blob = b;
      totalRows = t;
      break;
    }

    case 'txt': {
      const { text, totalRows: t } = exportToTXT(records, config);
      blob = new Blob([text], { type: 'text/plain; charset=utf-8' });
      totalRows = t;
      break;
    }

    default: {
      throw new Error(`不支持的导出格式: ${config.format}`);
    }
  }

  const elapsed = performance.now() - start;

  return {
    format: config.format,
    blob,
    filename: config.filename,
    totalRows,
    totalChunks,
    exportedAt: new Date().toISOString(),
  };
}

// ─── 触发浏览器下载 ───

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── 批量导出（支持大文件分片） ───

export async function batchExport(
  dataSource: unknown[],
  config: BatchExportConfig
): Promise<ExportResult[]> {
  const totalRows = dataSource.length;
  const results: ExportResult[] = [];

  if (config.chunkSize > 0 && totalRows > config.chunkSize) {
    // 大文件：分片导出
    const chunkSize = config.chunkSize;
    const chunkCount = Math.ceil(totalRows / chunkSize);

    for (let i = 0; i < chunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, totalRows);
      const chunk = dataSource.slice(start, end);
      const chunkConfig: ExportConfig = {
        ...config,
        filename: `${config.filename}-${i + 1}`,
      };
      const result = await exportBatch(chunk, chunkConfig);
      results.push(result);
    }
  } else {
    // 小文件：一次性导出
    const result = await exportBatch(dataSource, config as ExportConfig);
    results.push(result);
  }

  return results;
}

// ─── 导出配置模板（按数据源预设） ───

export function getDefaultExportConfig(dataSource: string): FieldMapping[] {
  const defaults: Record<string, FieldMapping[]> = {
    'hrms': [
      { sourceField: 'name', targetField: '姓名', required: true },
      { sourceField: 'department', targetField: '部门', required: false },
      { sourceField: 'position', targetField: '职位', required: false },
      { sourceField: 'pillar', targetField: '支柱', required: false },
      { sourceField: 'status', targetField: '状态', required: false },
    ],
    'ogsm': [
      { sourceField: 'title', targetField: '标题', required: true },
      { sourceField: 'level', targetField: '层级', required: true },
      { sourceField: 'status', targetField: '状态', required: false },
      { sourceField: 'description', targetField: '描述', required: false },
      { sourceField: 'target', targetField: '目标值', required: false },
      { sourceField: 'metric', targetField: '指标', required: false },
    ],
    'tasks': [
      { sourceField: 'title', targetField: '任务标题', required: true },
      { sourceField: 'status', targetField: '状态', required: true },
      { sourceField: 'priority', targetField: '优先级', required: true },
      { sourceField: 'progress', targetField: '进度', required: false },
      { sourceField: 'description', targetField: '描述', required: false },
    ],
    'raci': [
      { sourceField: 'taskId', targetField: '任务ID', required: true },
      { sourceField: 'employeeId', targetField: '员工ID', required: true },
      { sourceField: 'employeeName', targetField: '员工姓名', required: true },
      { sourceField: 'role', targetField: '角色', required: true },
    ],
    'risks': [
      { sourceField: 'title', targetField: '风险标题', required: true },
      { sourceField: 'severity', targetField: '严重度', required: true },
      { sourceField: 'status', targetField: '状态', required: true },
      { sourceField: 'description', targetField: '描述', required: false },
    ],
    'incentives': [
      { sourceField: 'type', targetField: '类型', required: true },
      { sourceField: 'rule', targetField: '规则', required: true },
      { sourceField: 'status', targetField: '状态', required: true },
    ],
    'pilots': [
      { sourceField: 'name', targetField: '试点名称', required: true },
      { sourceField: 'status', targetField: '状态', required: true },
      { sourceField: 'startDate', targetField: '开始日期', required: true },
    ],
    'policies': [
      { sourceField: 'title', targetField: '制度标题', required: true },
      { sourceField: 'version', targetField: '版本', required: true },
      { sourceField: 'status', targetField: '状态', required: true },
    ],
    'employees': [
      { sourceField: 'name', targetField: '姓名', required: true },
      { sourceField: 'department', targetField: '部门', required: false },
      { sourceField: 'position', targetField: '职位', required: false },
      { sourceField: 'pillar', targetField: '支柱', required: false },
    ],
  };
  return defaults[dataSource] || defaults['hrms'];
}

// ─── 导出所有 HRMS 数据 ───

export function buildExportFilename(dataSource: string, format: ExportFormat): string {
  const now = new Date();
  const ts = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  return `vorzai-ecommerce-${dataSource}-${ts}.${format}`;
}
