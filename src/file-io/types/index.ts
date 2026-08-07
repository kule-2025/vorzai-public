/**
 * 文件导入导出 — 类型系统
 * 定义文件格式、解析结果、错误报告、导出配置等
 */

// ─── 文件格式枚举 ───

export type SupportedFormat =
  | 'json'         // JSON（单对象/数组）
  | 'jsonl'        // JSON Lines（逐行 JSON）
  | 'csv'          // CSV 逗号分隔
  | 'tsv'          // TSV 制表符分隔
  | 'xlsx'         // Excel 工作簿
  | 'xls'          // Excel 旧格式
  | 'txt'          // 纯文本（日志/逐行）
  | 'xml'          // XML 结构化数据
  | 'pdf'          // PDF 文档（元数据提取）
  | 'yaml'         // YAML 配置/数据
  | 'unknown';

export type ExportFormat = 'json' | 'csv' | 'xlsx' | 'txt';

// ─── 文件识别结果 ───

export interface FileMeta {
  file: File;
  format: SupportedFormat;
  size: number;          // 字节
  sizeLabel: string;     // 人类可读大小
  lastModified: number;
  name: string;
}

// ─── 解析结果 ───

export type ParseChunkCallback = (chunk: unknown[], index: number) => Promise<void> | void;

export interface ParseResult<T = unknown[]> {
  format: SupportedFormat;
  data: T;
  headers: string[];     // CSV/XLSX 列头
  totalRows: number;
  encoding: string;
  warnings: ParseWarning[];
}

export interface ParseWarning {
  level: 'warn' | 'info';
  message: string;
  index?: number;
}

// ─── 错误报告 ───

export interface ImportError {
  file: string;
  index: number;         // 行号/记录序号
  message: string;
  severity: 'error' | 'warn';
  field?: string;
  value?: unknown;
}

export interface ImportReport {
  fileMeta: FileMeta;
  format: SupportedFormat;
  totalRows: number;
  successRows: number;
  errorRows: number;
  errors: ImportError[];
  importedAt: string;
}

// ─── 字段映射 ───

export interface FieldMapping {
  sourceField: string;   // 源文件字段名
  targetField: string;   // 目标字段名
  required: boolean;
  defaultValue?: unknown;
}

export interface ExportConfig {
  format: ExportFormat;
  fieldMapping: FieldMapping[];
  encoding: 'utf-8' | 'utf-8-bom' | 'gbk';
  includeHeaders: boolean;
  chunkSize: number;     // 大文件分片大小（行数）
  filename: string;
}

// ─── 批量任务状态 ───

export type BatchTaskStatus = 'pending' | 'parsing' | 'validating' | 'importing' | 'completed' | 'failed';

export interface BatchImportTask {
  id: string;
  fileMeta: FileMeta;
  status: BatchTaskStatus;
  report?: ImportReport;
  progress?: { current: number; total: number };
  errors?: ImportError[];
}

export interface BatchExportConfig extends ExportConfig {
  dataSource: 'hrms' | 'ogsm' | 'tasks' | 'raci' | 'risks' | 'incentives' | 'pilots' | 'policies' | 'employees';
  filter?: Record<string, unknown>;  // 查询条件
}

// ─── 导出结果 ───

export interface ExportResult {
  format: ExportFormat;
  blob: Blob;
  filename: string;
  totalRows: number;
  totalChunks: number;
  exportedAt: string;
}

// ─── 大文件分片配置 ───

export interface ChunkConfig {
  enabled: boolean;
  maxChunkSize: number;  // 最大单片行数（0 = 不分片）
  concurrency: number;   // 并发处理数
}

// 默认配置
export const DEFAULT_CHUNK_CONFIG: ChunkConfig = {
  enabled: true,
  maxChunkSize: 5000,
  concurrency: 2,
};

// 支持的 MIME 类型映射
export const FORMAT_MIME: Record<string, SupportedFormat> = {
  'application/json': 'json',
  'application/jsonlines': 'jsonl',
  'application/x-json': 'json',
  'text/csv': 'csv',
  'text/comma-separated-values': 'csv',
  'text/tab-separated-values': 'tsv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'text/plain': 'txt',
  'text/xml': 'xml',
  'application/xml': 'xml',
  'application/pdf': 'pdf',
  'text/yaml': 'yaml',
  'application/x-yaml': 'yaml',
};

// 扩展名 → 格式
export const FORMAT_EXT: Record<string, SupportedFormat> = {
  '.json': 'json',
  '.jsonl': 'jsonl',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.xlsx': 'xlsx',
  '.xls': 'xls',
  '.txt': 'txt',
  '.xml': 'xml',
  '.pdf': 'pdf',
  '.yaml': 'yaml',
  '.yml': 'yaml',
};
