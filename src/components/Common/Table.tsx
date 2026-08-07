/**
 * Table 组件 — 通用数据表
 *
 * 特性：
 * - 配置式 columns（title/key/width/align/render/sortable）
 * - 内置 loading / empty 占位
 * - 简单排序（单列）
 * - 横向滚动（容器 maxWidth 触发）
 * - 行 hover 高亮
 * - 深浅色适配
 */
import React, { useMemo, useState } from 'react';
import { Empty } from './Empty';
import { Loading } from './Loading';

export interface TableColumn<T> {
  key: string;
  title: React.ReactNode;
  width?: number | string;
  align?: 'left' | 'center' | 'right';
  render?: (row: T, index: number) => React.ReactNode;
  sortable?: boolean;
  sorter?: (a: T, b: T) => number;
  className?: string;
}

export interface TableProps<T> {
  columns: TableColumn<T>[];
  data: T[];
  rowKey?: keyof T | ((row: T, index: number) => string);
  loading?: boolean;
  empty?: React.ReactNode;
  size?: 'sm' | 'md';
  stickyHeader?: boolean;
  maxHeight?: number | string;
  onRowClick?: (row: T, index: number) => void;
  zebra?: boolean;
}

export function Table<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey = 'id' as keyof T,
  loading = false,
  empty,
  size = 'md',
  stickyHeader = false,
  maxHeight,
  onRowClick,
  zebra = false,
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedData = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;
    const sorter = col.sorter ?? ((a: T, b: T) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return -1;
      if (bv == null) return 1;
      if (typeof av === 'number' && typeof bv === 'number') return av - bv;
      return String(av).localeCompare(String(bv));
    });
    const sorted = [...data].sort((a, b) => sorter(a, b));
    return sortDir === 'asc' ? sorted : sorted.reverse();
  }, [data, sortKey, sortDir, columns]);

  const getRowKey = (row: T, i: number): string => {
    if (typeof rowKey === 'function') return rowKey(row, i);
    const v = row[rowKey];
    return v == null ? String(i) : String(v);
  };

  const handleHeaderClick = (col: TableColumn<T>) => {
    if (!col.sortable && !col.sorter) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(col.key);
      setSortDir('asc');
    }
  };

  const cellPad = size === 'sm' ? '8px 10px' : '12px 14px';
  const fontSize = size === 'sm' ? 12 : 13;

  return (
    <div
      style={{
        width: '100%',
        overflow: 'auto',
        border: '1px solid var(--border-card)',
        borderRadius: 8,
        background: 'var(--bg-card)',
        maxHeight,
      }}
    >
      <table
        role="table"
        style={{
          width: '100%',
          borderCollapse: 'separate',
          borderSpacing: 0,
          fontSize,
          color: 'var(--text-primary)',
        }}
      >
        <thead
          style={{
            position: stickyHeader ? 'sticky' : 'static',
            top: 0,
            zIndex: 1,
          }}
        >
          <tr>
            {columns.map((col) => {
              const isSort = (col.sortable || col.sorter) && sortKey === col.key;
              return (
                <th
                  key={col.key}
                  onClick={() => handleHeaderClick(col)}
                  style={{
                    textAlign: col.align ?? 'left',
                    padding: cellPad,
                    fontWeight: 600,
                    fontSize: size === 'sm' ? 11 : 12,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-table-header, var(--bg-sidebar))',
                    borderBottom: '1px solid var(--border-divider)',
                    width: col.width,
                    minWidth: 60,
                    cursor: (col.sortable || col.sorter) ? 'pointer' : 'default',
                    userSelect: 'none',
                    whiteSpace: 'nowrap',
                  }}
                  className={col.className}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {col.title}
                    {(col.sortable || col.sorter) && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 10 }}>
                        {isSort ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 0, borderBottom: 'none' }}>
                <Loading text="加载中..." />
              </td>
            </tr>
          ) : sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 0, borderBottom: 'none' }}>
                {empty ?? <Empty title="暂无数据" size="sm" />}
              </td>
            </tr>
          ) : (
            sortedData.map((row, i) => (
              <tr
                key={getRowKey(row, i)}
                onClick={onRowClick ? () => onRowClick(row, i) : undefined}
                style={{
                  cursor: onRowClick ? 'pointer' : 'default',
                  background: zebra && i % 2 === 1 ? 'var(--bg-table-stripe, var(--bg-sidebar))' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={(e) => {
                  if (onRowClick) e.currentTarget.style.background = 'var(--bg-hover, rgba(0,0,0,0.04))';
                }}
                onMouseLeave={(e) => {
                  if (onRowClick) {
                    e.currentTarget.style.background = zebra && i % 2 === 1 ? 'var(--bg-table-stripe, var(--bg-sidebar))' : 'transparent';
                  }
                }}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{
                      textAlign: col.align ?? 'left',
                      padding: cellPad,
                      borderBottom: '1px solid var(--border-divider)',
                      verticalAlign: 'middle',
                    }}
                  >
                    {col.render ? col.render(row, i) : (row[col.key] as React.ReactNode)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export default Table;
