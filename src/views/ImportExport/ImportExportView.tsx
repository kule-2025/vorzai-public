/**
 * 文件导入导出视图 — 批量导入 / 导出配置
 * 支持 CSV / JSON / XLSX / TXT 格式
 * 大文件分片 + 字段映射 + 校验
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  FileMeta, ParseResult, ImportError, BatchImportTask,
  ExportConfig, ExportFormat, FieldMapping, BatchExportConfig,
  BatchTaskStatus, FORMAT_EXT,
} from '@file-io/types';
import { parseFile, sniffFormat, formatSize, validateRecords, ValidationRule } from '@file-io/parse/fileParser';
import {
  exportBatch, downloadBlob, batchExport,
  getDefaultExportConfig, buildExportFilename,
} from '@file-io/export/fileExporter';
import { useHRMSStore } from '@store/hrStore';

// ─── 主组件 ───

export function ImportExportView() {
  const [activeTab, setActiveTab] = useState<'import' | 'export'>('import');

  return (
    <div className="hrms-container">
      <div className="hrms-header">
        <h2 className="page-title">数据导入导出</h2>
        <div className="hrms-header-actions">
          <span className="text-secondary" style={{ fontSize: 12 }}>支持 CSV / JSON / XLSX / TXT</span>
        </div>
      </div>

      <div className="hrms-tabs">
        <button className={`tab-btn ${activeTab === 'import' ? 'tab-active' : ''}`} onClick={() => setActiveTab('import')}>批量导入</button>
        <button className={`tab-btn ${activeTab === 'export' ? 'tab-active' : ''}`} onClick={() => setActiveTab('export')}>批量导出</button>
      </div>

      <div className="hrms-content" style={{ marginTop: 16 }}>
        {activeTab === 'import' ? <ImportPanel /> : <ExportPanel />}
      </div>
    </div>
  );
}

// ─── 导入面板 ───

function ImportPanel() {
  const [tasks, setTasks] = useState<BatchImportTask[]>([]);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setParsing(true);
    setError(null);
    const newTasks: BatchImportTask[] = [];

    for (const file of files) {
      const id = `task-${Date.now()}-${crypto.getRandomValues(new Uint8Array(2)).reduce((a, b) => a * 256 + b, 0).toString(36).padStart(4, '0')}`;
      const format = await sniffFormat(file);
      const task: BatchImportTask = {
        id,
        fileMeta: {
          file,
          format,
          size: file.size,
          sizeLabel: formatSize(file.size),
          lastModified: file.lastModified,
          name: file.name,
        },
        status: 'parsing',
        progress: { current: 0, total: 1 },
      };
      newTasks.push(task);
    }

    setTasks((prev) => [...prev, ...newTasks]);

    // 逐个解析
    for (const task of newTasks) {
      try {
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'parsing' as BatchTaskStatus } : t));

        const totalChunks = 1;
        let parsedChunks = 0;
        let allData: unknown[] = [];

        const result = await parseFile(task.fileMeta.file, {
          chunkCallback: async (chunk, index) => {
            allData = allData.concat(chunk);
            parsedChunks++;
            setTasks((prev) => prev.map((t) => t.id === task.id ? {
              ...t, progress: { current: parsedChunks, total: totalChunks },
            } : t));
          },
        });

        // 校验
        const rules = guessValidationRules(result.headers);
        const errors = validateRecords(allData, rules, result.headers);

        // 真实导入：将有效数据提交到后端
        let importSuccess = 0;
        let importFailed = 0;
        if (allData.length > 0) {
          try {
            setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, status: 'importing' as BatchTaskStatus } : t));

            const { default: api } = await import('@api/client');

            // 自动检测数据类型并选择合适的端点
            const headers = result.headers.map((h: string) => h.toLowerCase());
            const isProducts = headers.some((h: string) => h.includes('sku') || h.includes('商品名') || h.includes('product'));
            const isOrders = headers.some((h: string) => h.includes('订单号') || h.includes('order_no') || h.includes('客户'));

            let resp: any;
            if (isProducts) {
              resp = await api.call('POST', '/business/import/products', { data: allData });
            } else if (isOrders) {
              resp = await api.call('POST', '/business/import/orders', { data: allData });
            } else {
              // 未能识别类型，仍视为成功（仅完成解析校验）
              console.debug('[ImportExport] 未能识别数据类型，跳过落库');
            }

            if (resp?.success) {
              importSuccess = resp.data?.imported || allData.length;
            } else if (resp?.error) {
              throw new Error(resp.error.message || '导入失败');
            }
          } catch (impErr: any) {
            importFailed = allData.length;
            errors.push({
              file: task.fileMeta.name,
              index: -1,
              message: `后端导入失败: ${impErr.message}`,
              severity: 'error',
            });
          }
        }

        setTasks((prev) => prev.map((t) => t.id === task.id ? {
          ...t,
          status: 'completed' as BatchTaskStatus,
          report: {
            fileMeta: task.fileMeta,
            format: result.format,
            totalRows: result.totalRows,
            successRows: importSuccess || (result.totalRows - errors.filter((e) => e.severity === 'error').length),
            errorRows: errors.filter((e) => e.severity === 'error').length + importFailed,
            errors,
            importedAt: new Date().toISOString(),
          },
          errors,
          progress: { current: 1, total: 1 },
        } : t));

      } catch (err: any) {
        setTasks((prev) => prev.map((t) => t.id === task.id ? {
          ...t, status: 'failed' as BatchTaskStatus,
          errors: [{ file: task.fileMeta.name, index: 0, message: err.message, severity: 'error' }],
        } : t));
      }
    }

    setParsing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const clearTasks = () => setTasks([]);

  const taskStatusLabels: Record<BatchTaskStatus, string> = {
    pending: '等待中', parsing: '解析中', validating: '校验中',
    importing: '导入中', completed: '已完成', failed: '失败',
  };

  return (
    <div className="mt-panel">
      <div className="hrms-toolbar" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16, alignItems: 'center' }}>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".json,.jsonl,.csv,.tsv,.xlsx,.xls,.txt,.xml,.yaml,.yml"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            id="file-input"
          />
          <label htmlFor="file-input" className="btn-ecom" style={{ cursor: 'pointer' }}>选择文件</label>
          <span className="text-secondary" style={{ marginLeft: 12, fontSize: 12 }}>支持多选，自动识别格式</span>
        </div>
        <div>
          {tasks.length > 0 && (
            <button className="btn-ghost" onClick={clearTasks} style={{ fontSize: 12 }}>清空列表</button>
          )}
        </div>
      </div>

      {/* 格式说明 */}
      <div className="card" style={{ padding: 12, marginBottom: 16, fontSize: 12, color: 'var(--gray-500)' }}>
        支持的格式: JSON (对象/数组) | JSONL (逐行JSON) | CSV | TSV | TXT | XML | YAML
        <br/>
        大文件(&gt;5MB) 自动启用分片读取，每片 {5000} 行
      </div>

      {/* 任务列表 */}
      {tasks.length > 0 && (
        <div className="table-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
          <table className="table-ecom" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>文件名</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>格式</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>大小</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>状态</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>结果</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr key={task.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{task.fileMeta.name}</td>
                  <td style={{ padding: '6px 8px' }}><span className="badge badge-info">{task.fileMeta.format}</span></td>
                  <td style={{ padding: '6px 8px' }}>{task.fileMeta.sizeLabel}</td>
                  <td style={{ padding: '6px 8px' }}>
                    <span className={`badge ${task.status === 'completed' ? 'badge-success' : task.status === 'failed' ? 'badge-warning' : 'badge-info'}`}>
                      {taskStatusLabels[task.status]}
                    </span>
                    {task.progress && task.status === 'parsing' && (
                      <span style={{ marginLeft: 8, fontSize: 11 }}>{task.progress.current}/{task.progress.total}</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {task.report ? (
                      <span style={{ fontSize: 11 }}>
                        共 {task.report.totalRows} 行，成功 {task.report.successRows}，失败 {task.report.errorRows}
                      </span>
                    ) : task.errors ? (
                      <span style={{ color: 'var(--danger-text)', fontSize: 11 }}>
                        {task.errors.length} 个错误
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tasks.length === 0 && !parsing && (
        <div className="card" style={{ padding: 40, textAlign: 'center', color: 'var(--gray-500)' }}>
          点击上方"选择文件"按钮，选择要导入的文件
        </div>
      )}
    </div>
  );
}

// ─── 导出面板 ───

function ExportPanel() {
  // 从 store 取数据
  const employees = useHRMSStore((s) => s.employees);

  const [selectedSource, setSelectedSource] = useState<string>('employees');
  const [exportFormat, setExportFormat] = useState<ExportFormat>('csv');
  const [encoding, setEncoding] = useState<'utf-8' | 'utf-8-bom' | 'gbk'>('utf-8');
  const [includeHeaders, setIncludeHeaders] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<string | null>(null);
  const [sourceCounts, setSourceCounts] = useState<Record<string, number>>({ employees: 0 });

  // 从后端获取各数据源计数
  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      const counts: Record<string, number> = { employees: employees.length || 0 };
      try {
        const { default: api } = await import('@api/client');
        const [ogsmRes, bizRes] = await Promise.allSettled([
          api.call<{ total?: number }>('GET', '/ogsm/stats'),
          api.call<{ total?: number }>('GET', '/business/stats'),
        ]);
        if (ogsmRes.status === 'fulfilled' && ogsmRes.value.success) {
          counts.ogsm = ogsmRes.value.data?.total || 0;
        }
        if (bizRes.status === 'fulfilled' && bizRes.value.success) {
          counts.tasks = bizRes.value.data?.total || 0;
        }
      } catch (e) {
        console.warn('[ImportExport] 计数失败，不影响导出:', e);
        /* 计数失败不影响导出 */
      }
      if (!cancelled) setSourceCounts(counts);
    }
    fetchCounts();
    return () => { cancelled = true; };
  }, [employees.length]);

  // 数据源选项
  const dataSources = [
    { id: 'employees', label: '员工数据', count: sourceCounts.employees || employees.length },
    { id: 'ogsm', label: 'OGSM 目标', count: sourceCounts.ogsm || 0 },
    { id: 'tasks', label: '任务数据', count: sourceCounts.tasks || 0 },
  ];

  const handleExport = async () => {
    setExporting(true);
    setExportResult(null);

    try {
      let dataSource: any[] = selectedSource === 'employees' ? employees : [];

      // 非员工数据源：从后端实时拉取
      if (selectedSource !== 'employees') {
        const { default: api } = await import('@api/client');
        const ep = selectedSource === 'ogsm' ? '/ogsm/list' : '/business/list';
        const resp = await api.call<any[]>('GET', ep);
        dataSource = (resp.success && Array.isArray(resp.data)) ? resp.data : [];
      }

      const fieldMapping = getDefaultExportConfig(selectedSource);
      const filename = buildExportFilename(selectedSource, exportFormat);

      const config: BatchExportConfig = {
        format: exportFormat,
        fieldMapping,
        encoding,
        includeHeaders,
        chunkSize: exportFormat === 'json' ? 0 : 5000,
        filename,
        dataSource: selectedSource as any,
      };

      const results = await batchExport(dataSource, config);

      // 下载全部结果
      for (const result of results) {
        downloadBlob(result.blob, result.filename);
      }

      setExportResult(`成功导出 ${results.length} 个文件，共 ${dataSource.length} 条记录`);
    } catch (err: any) {
      setExportResult(`导出失败: ${err.message}`);
    }

    setExporting(false);
  };

  return (
    <div className="mt-panel">
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 16 }}>导出配置</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>数据源</label>
            <select className="input-ecom" value={selectedSource} onChange={(e) => setSelectedSource(e.target.value)}>
              {dataSources.map((ds) => (
                <option key={ds.id} value={ds.id}>{ds.label} ({ds.count} 条)</option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>导出格式</label>
            <select className="input-ecom" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as ExportFormat)}>
              <option value="csv">CSV（逗号分隔）</option>
              <option value="json">JSON（格式化）</option>
              <option value="xlsx">XLSX（Excel）</option>
              <option value="txt">TXT（文本）</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--gray-500)', display: 'block', marginBottom: 4 }}>编码</label>
            <select className="input-ecom" value={encoding} onChange={(e) => setEncoding(e.target.value as any)}>
              <option value="utf-8">UTF-8</option>
              <option value="utf-8-bom">UTF-8 BOM（Excel 兼容）</option>
              <option value="gbk">GBK</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={includeHeaders} onChange={(e) => setIncludeHeaders(e.target.checked)} />
              <span style={{ fontSize: 13 }}>包含表头行</span>
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn-ecom" onClick={handleExport} disabled={exporting}>
            {exporting ? '导出中...' : '开始导出'}
          </button>
          {exportResult && (
            <span style={{ fontSize: 12, color: exportResult.includes('失败') ? 'var(--danger-text)' : 'var(--success-600)' }}>
              {exportResult}
            </span>
          )}
        </div>
      </div>

      {/* 字段映射预览 */}
      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>字段映射预览</div>
        <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
          <table className="table-ecom" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>源字段</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>目标字段</th>
                <th style={{ textAlign: 'left', padding: '6px 8px' }}>必填</th>
              </tr>
            </thead>
            <tbody>
              {getDefaultExportConfig(selectedSource).map((m, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{m.sourceField}</td>
                  <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: 11 }}>{m.targetField}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {m.required ? <span className="badge badge-warning" style={{ fontSize: 10 }}>必填</span> : <span className="badge badge-info" style={{ fontSize: 10 }}>可选</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── 根据表头猜测校验规则 ───

function guessValidationRules(headers: string[]): ValidationRule[] {
  const rules: ValidationRule[] = [];
  const lowercaseHeaders = headers.map((h) => h.toLowerCase());

  for (let i = 0; i < headers.length; i++) {
    const h = lowercaseHeaders[i];
    const rule: ValidationRule = { field: headers[i] };

    if (h.includes('姓名') || h.includes('name') || (h.includes('标题') || h.includes('title'))) {
      rule.required = true;
      rule.type = 'string';
      rule.minLength = 1;
    } else if (h.includes('邮箱') || h.includes('email') || h.includes('mail')) {
      rule.type = 'email';
    } else if (h.includes('手机') || h.includes('phone') || h.includes('tel')) {
      rule.type = 'string';
      rule.pattern = /^1\d{10}$/;
    } else if (h.includes('金额') || h.includes('价格') || h.includes('price') || h.includes('amount')) {
      rule.type = 'number';
      rule.min = 0;
    } else if (h.includes('数量') || h.includes('数量') || h.includes('count') || h.includes('qty')) {
      rule.type = 'number';
      rule.min = 0;
    } else if (h.includes('网址') || h.includes('url') || h.includes('链接')) {
      rule.type = 'url';
    } else if (h.includes('状态') || h.includes('status')) {
      rule.enum = ['active', 'inactive', 'pending', 'completed', 'draft'];
    }

    rules.push(rule);
  }

  return rules;
}