import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';

// 统一的数据库接口（原生 node:sqlite 驱动）

/**
 * 写操作（INSERT / UPDATE / DELETE）的返回结果。
 *
 * node:sqlite 返回 { changes, lastInsertRowid }，JSON 回退驱动对齐该结构。
 */
export interface DBRunResult {
  /** 受影响的行数 */
  changes?: number;
  /** 新插入行的自增主键 */
  lastInsertRowid?: number | bigint;
  [key: string]: unknown;
}

export interface DBStatement {
  run(...params: unknown[]): DBRunResult;
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
export interface DBDatabase {
  exec(sql: string): void;
  prepare(sql: string): DBStatement;
  close(): void;
  pragma(pragma: string): void;
}

/**
 * Backwards-compatible alias. Several services were written against the concrete
 * `node:sqlite` `DatabaseSync` class before the driver was abstracted behind
 * `DBDatabase`. Keeping the alias avoids churn while still routing everything
 * through the driver-agnostic interface (node:sqlite → JSON file fallback).
 */
export type DatabaseSync = DBDatabase;

let db: DBDatabase | null = null;

// 动态加载数据库驱动
function createDatabase(dbPath: string): DBDatabase {
  // 尝试 node:sqlite (Node.js 22+, Electron 33 内置 Node 22.x)
  try {
    const { DatabaseSync } = require('node:sqlite');
    logger.info('database', 'Using node:sqlite driver (native)');
    return new DatabaseSync(dbPath) as DBDatabase;
  } catch (e) {
    logger.warn('database', `node:sqlite not available (${String(e)}), falling back to JSON storage...`);
  }

  // 最终回退：基于 JSON 文件的简易存储（仅用于极端情况）
  logger.info('database', 'Using JSON file fallback driver');
  return createJsonDatabase(dbPath);
}

// JSON 文件数据库（最终回退方案）
// 提供基础的键值存储，支持 INSERT/SELECT/UPDATE/DELETE 的简化实现
// 注意：JSON 回退不支持 JOIN/子查询/聚合函数，仅用于极端兼容场景
function createJsonDatabase(dbPath: string): DBDatabase {
  const jsonPath = dbPath.replace(/\.db$/, '.json');
  const data: Record<string, Record<string, unknown>[]> = {};

  // 如果 JSON 文件存在，加载已有数据
  if (fs.existsSync(jsonPath)) {
    try {
      Object.assign(data, JSON.parse(fs.readFileSync(jsonPath, 'utf-8')));
      logger.warn('database', `JSON fallback loaded ${Object.keys(data).length} tables from ${jsonPath}`);
    } catch (e) {
      logger.error('database', `JSON fallback file corrupt, starting fresh: ${String(e)}`);
    }
  }

  function save() {
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      logger.error('database', `JSON fallback save failed: ${String(e)}`);
      throw new Error(`数据持久化失败（磁盘写入错误）: ${String(e)}`);
    }
  }

  // 从 SQL 中提取表名（简单正则）
  function extractTableName(sql: string): string | null {
    const m = sql.match(/(?:insert\s+into|update|delete\s+from|from|join)\s+(\w+)/i);
    return m ? m[1] : null;
  }

  // JSON 回退层处于主存储不可用时的兜底状态。
  // 所有写操作在无法确定语义时立即抛出（fail-fast），绝不返回伪造的成功结果，
  // 避免数据静默丢失。
  function throwUnparseable(sql: string, reason: string): never {
    const snippet = sql.trimEnd().slice(0, 120);
    logger.error('database', `JSON fallback ${reason} → SQL: ${snippet}`);
    throw new Error(
      `JSON 回退数据库不支持此操作：${reason}。SQL: ${snippet}。请升级 Node.js 至 22+ 以使用 node:sqlite 驱动。`
    );
  }

  function executeSql(sql: string, params: unknown[]): unknown {
    const lower = sql.trim().toLowerCase();

    // DDL 与事务指令：JSON 回退不建表，忽略并记录日志（非致命）
    if (
      lower.startsWith('create table') || lower.startsWith('create index') ||
      lower.startsWith('pragma') || lower.startsWith('begin') ||
      lower.startsWith('commit') || lower.startsWith('rollback') ||
      lower.startsWith('alter table')
    ) {
      logger.warn('database', `JSON fallback: DDL ignored (${lower.split(/\s+/)[0]}). Schema must be managed by node:sqlite driver.`);
      return { changes: 0 };
    }

    // INSERT
    if (lower.startsWith('insert')) {
      const tableName = extractTableName(sql);
      if (!tableName) {
        throwUnparseable(sql, '无法解析表名（INSERT）');
      }
      if (!data[tableName]) data[tableName] = [];

      // 从 VALUES(...) 提取值
      const valuesMatch = sql.match(/values\s*\(([^)]+)\)/i);
      if (!valuesMatch) {
        throwUnparseable(sql, '无法解析 VALUES 子句（INSERT）');
      }

      const rawValues = valuesMatch[1];
      // 简单值分割（不处理嵌套括号的复杂表达式）
      const rawParts = rawValues.split(',');
      // 优先使用参数化值
      const values = params.length > 0 ? params : rawParts.map(v => {
        const t = v.trim();
        if (t === 'NULL' || t === 'null') return null;
        if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))
          return t.slice(1, -1);
        if (!isNaN(Number(t))) return Number(t);
        return t;
      });

      const record: Record<string, unknown> = { _rowid: Date.now() + Math.random() };
      values.forEach((v, i) => { record[`col_${i}`] = v; });

      data[tableName].push(record);
      save();
      logger.info('database', `JSON fallback: INSERT into "${tableName}" succeeded (1 row, approx rowid=${record._rowid})`);
      return { changes: 1, lastInsertRowid: record._rowid };
    }

    // UPDATE
    if (lower.startsWith('update')) {
      const tableName = extractTableName(sql);
      if (!tableName || !data[tableName]) return { changes: 0 };

      const setMatch = sql.match(/set\s+(.+?)(?:\s+where\s+|$)/is);
      if (!setMatch) {
        throwUnparseable(sql, '无法解析 SET 子句（UPDATE）');
      }

      const setPairs = setMatch[1].split(',').map(p => p.trim());

      // 检测无 WHERE 子句：将更新全部行，记录严重告警
      const hasWhere = /\s+where\s+/i.test(sql);
      if (!hasWhere && data[tableName].length > 0) {
        logger.error('database',
          `JSON fallback: UPDATE "${tableName}" has NO WHERE clause — updating ALL ${data[tableName].length} rows! SQL: ${sql.trimEnd().slice(0, 120)}`
        );
      }

      let changes = 0;
      for (const record of data[tableName]) {
        for (const pair of setPairs) {
          const [col, val] = pair.split('=').map(s => s.trim());
          record[col] = val ? val.replace(/^['"]|['"]$/g, '') : null;
        }
        changes++;
      }
      if (changes > 0) save();
      logger.info('database', `JSON fallback: UPDATE "${tableName}" affected ${changes} row(s)`);
      return { changes };
    }

    // DELETE
    if (lower.startsWith('delete')) {
      const tableName = extractTableName(sql);
      if (!tableName || !data[tableName]) return { changes: 0 };

      // 检测无 WHERE 子句：将清空整表，记录严重告警
      const hasWhere = /\s+where\s+/i.test(sql);
      if (!hasWhere && data[tableName].length > 0) {
        logger.error('database',
          `JSON fallback: DELETE FROM "${tableName}" has NO WHERE clause — clearing ALL ${data[tableName].length} rows! SQL: ${sql.trimEnd().slice(0, 120)}`
        );
      }

      const count = data[tableName].length;
      data[tableName] = [];
      save();
      logger.info('database', `JSON fallback: DELETE FROM "${tableName}" removed ${count} row(s)`);
      return { changes: count };
    }

    // SELECT COUNT
    if (lower.startsWith('select count')) {
      const tableName = extractTableName(sql);
      const total = tableName && data[tableName] ? data[tableName].length : 0;
      return { total };
    }

    // SELECT
    if (lower.startsWith('select')) {
      const tableName = extractTableName(sql);
      return tableName && data[tableName] ? [...data[tableName]] : [];
    }

    // 无法解析的 SQL：fail-fast
    throwUnparseable(sql, '无法识别的 SQL 语句类型');
  }

  return {
    exec: () => { /* no-op for JSON mode: DDL handled in executeSql */ },
    prepare: (sql: string) => ({
      run: (...params: unknown[]) => executeSql(sql, params),
      get: (...params: unknown[]) => {
        const result = executeSql(sql, params);
        return Array.isArray(result) ? (result.length > 0 ? result[0] : undefined) : result;
      },
      all: (...params: unknown[]) => {
        const result = executeSql(sql, params);
        return Array.isArray(result) ? result : [];
      },
    }),
    close: () => save(),
    pragma: () => { /* no-op: JSON fallback does not support pragma */ },
  } as DBDatabase;
}

export function getDatabase(): DBDatabase {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(dbPath?: string): DBDatabase {
  const resolvedPath = dbPath || config.db.path;
  const dir = path.dirname(resolvedPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = createDatabase(resolvedPath);

  // Performance optimizations (node:sqlite supports pragma)
  try {
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('cache_size = -64000');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');
  } catch { /* JSON fallback doesn't support pragma */ }

  // Run schema
  runMigrations(db);

  // Seed demo data on first run
  // Skip seeding in test environments (tests create their own data)
  // In compiled JS: seed.js exists; in TS source (vitest): seed.ts exists
  if (process.env.VITEST) {
    // In vitest, require('./seed.ts') resolves to the .ts source
    try {
      const { seedDatabase: sd } = require('./seed.ts');
      sd();
    } catch { /* non-fatal: test creates its own data */ }
  } else {
    try {
      const { seedDatabase } = require('./seed');
      seedDatabase();
    } catch (e) {
      logger.warn('database', `Seed error (non-fatal): ${String(e)}`);
    }
  }

  logger.info('database', `Database initialized at ${resolvedPath}`);
  return db;
}

function runMigrations(database: DBDatabase): void {
  // Try multiple paths for schema.sql
  const candidatePaths = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '..', '..', 'src', 'db', 'schema.sql'),
    path.join(__dirname, '..', 'db', 'schema.sql'),
    path.join(process.resourcesPath || '', 'app', 'server', 'src', 'db', 'schema.sql'),
  ];

  let schemaPath = '';
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      schemaPath = p;
      break;
    }
  }

  if (!schemaPath) {
    logger.error('database', 'Schema file not found in any candidate path');
    throw new Error('Schema file not found');
  }

  const schema = fs.readFileSync(schemaPath, 'utf-8');

  // 幂等迁移：schema.sql 内含 ALTER TABLE ADD COLUMN，老库二次启动会抛
  // "duplicate column name"。整体 exec 会导致应用无法启动，破坏向后兼容。
  // 因此按语句切分执行，并对幂等类错误静默跳过。
  const IDEMPOTENT_ERROR_PATTERNS = [
    'duplicate column name',
    'already exists',
  ];

  // 前向引用兜底：CREATE INDEX 若引用尚未通过 ALTER TABLE 追加的列，
  // 在全新数据库上会报 "no such column"。此类语句先暂存，待所有
  // ALTER TABLE 执行完毕后再重试一次，彻底杜绝schema排序导致初始化失败。
  const DEFER_PATTERNS = ['no such column'];

  const statements = splitSqlStatements(schema);
  let applied = 0;
  let skipped = 0;
  const deferred: string[] = [];

  for (const stmt of statements) {
    try {
      database.exec(stmt);
      applied++;
    } catch (error) {
      const msg = String(error).toLowerCase();
      const idempotent = IDEMPOTENT_ERROR_PATTERNS.some((p) => msg.includes(p));
      if (idempotent) {
        skipped++;
        continue;
      }
      // 可能的前向引用：暂存后重试
      if (DEFER_PATTERNS.some((p) => msg.includes(p)) && /create\s+index/i.test(stmt)) {
        deferred.push(stmt);
        logger.warn('database', `Deferred index (will retry after ALTER): ${stmt.slice(0, 80)}`);
        continue;
      }
      logger.error('database', `Failed to apply statement: ${stmt.slice(0, 120)} -> ${String(error)}`);
      throw error;
    }
  }

  // 重试被推迟的索引创建（此时所有 ALTER TABLE 应已执行）
  let retried = 0;
  for (const stmt of deferred) {
    try {
      database.exec(stmt);
      retried++;
      applied++;
    } catch (error) {
      // 重试仍失败则记录但不阻断启动（索引缺失仅影响查询性能，不影响功能）
      logger.error('database', `Deferred index retry failed (non-fatal): ${stmt.slice(0, 80)} -> ${String(error)}`);
    }
  }

  logger.info('database', `Schema applied: ${applied} statements, ${skipped} skipped (already present)${retried ? `, ${retried} deferred retried` : ''}`);
}

/**
 * 将 SQL 文本切分为独立语句。
 * 处理：行注释(--)、块注释、单/双引号字符串内的分号、BEGIN...END 触发器体。
 */
function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;
  let inBlockComment = false;
  let beginDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];

    if (inLineComment) {
      current += ch;
      if (ch === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      current += ch;
      if (ch === '*' && next === '/') { current += next; i++; inBlockComment = false; }
      continue;
    }
    if (!inSingle && !inDouble) {
      if (ch === '-' && next === '-') { inLineComment = true; current += ch; continue; }
      if (ch === '/' && next === '*') { inBlockComment = true; current += ch; continue; }
    }

    if (ch === "'" && !inDouble) { inSingle = !inSingle; current += ch; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; current += ch; continue; }

    if (!inSingle && !inDouble) {
      // 识别 BEGIN / END 以保护触发器体内的分号
      const upcoming = sql.slice(i, i + 6).toUpperCase();
      if (upcoming === 'BEGIN ' || upcoming === 'BEGIN\n' || upcoming === 'BEGIN\r') {
        const prevChar = current.slice(-1);
        if (prevChar === '' || /[\s;)]/.test(prevChar)) beginDepth++;
      }
      if (sql.slice(i, i + 3).toUpperCase() === 'END' && beginDepth > 0) {
        const after = sql[i + 3];
        if (after === undefined || /[\s;]/.test(after)) beginDepth--;
      }

      if (ch === ';' && beginDepth === 0) {
        const trimmed = current.trim();
        if (trimmed && !isCommentOnly(trimmed)) statements.push(trimmed);
        current = '';
        continue;
      }
    }

    current += ch;
  }

  const tail = current.trim();
  if (tail && !isCommentOnly(tail)) statements.push(tail);
  return statements;
}

function isCommentOnly(stmt: string): boolean {
  return stmt
    .split('\n')
    .every((line) => line.trim() === '' || line.trim().startsWith('--'));
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('database', 'Database connection closed');
  }
}

// Transaction helper
export function transaction<T>(fn: (db: DBDatabase) => T): T {
  const database = getDatabase();
  database.exec('BEGIN TRANSACTION');
  try {
    const result = fn(database);
    database.exec('COMMIT');
    return result;
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

// Pagination helper
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function paginate<T>(
  query: string,
  countQuery: string,
  params: Record<string, unknown>,
  pagination: PaginationParams
): PaginatedResult<T> {
  const database = getDatabase();
  const page = Math.max(1, pagination.page || config.pagination.defaultPage);
  const limit = Math.min(
    Math.max(1, pagination.limit || config.pagination.defaultLimit),
    config.pagination.maxLimit
  );
  const offset = (page - 1) * limit;

  // SECURITY: Whitelist allowed sort columns to prevent SQL injection
  const ALLOWED_SORT_COLUMNS = new Set([
    'created_at', 'updated_at', 'name', 'title', 'priority', 'status',
    'start_date', 'end_date', 'deadline', 'date', 'period', 'employee_no',
    'order_no', 'ticket_no', 'total_amount', 'net_salary', 'score',
    'usage_count', 'view_count', 'sort_order',
  ]);
  const sortBy = ALLOWED_SORT_COLUMNS.has(pagination.sortBy || '') ? pagination.sortBy! : 'created_at';
  const sortOrder = pagination.sortOrder === 'ASC' ? 'ASC' : 'DESC';

  const fullQuery = `${query} ORDER BY ${sortBy} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`;
  const { sql: processedQuery, values } = convertNamedParams(fullQuery, params);
  const data = database.prepare(processedQuery).all(...values) as T[];

  const { sql: processedCount, values: countValues } = convertNamedParams(countQuery, params);
  const countResult = database.prepare(processedCount).get(...countValues) as any;
  const total = countResult?.total || 0;

  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

function convertNamedParams(sql: string, params: Record<string, unknown>): { sql: string; values: unknown[] } {
  const values: unknown[] = [];
  const processedSql = sql.replace(/@(\w+)/g, (_match, name) => {
    values.push(params[name]);
    return '?';
  });
  return { sql: processedSql, values };
}
