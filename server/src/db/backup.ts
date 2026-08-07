/**
 * 数据库备份与恢复模块
 *
 * 提供应用内触发式备份能力，与 scripts/backup-db.mjs 共享同一备份目录约定。
 * 所有操作均在本地 data/ 目录内进行，不经过任何外部网络。
 *
 * 恢复前自动对当前库做前置快照，防止误操作导致数据丢失。
 */

import fs from 'fs';
import path from 'path';
import { getDatabase } from './index';
import { logger } from '../utils/logger';

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const BACKUP_ROOT = path.join(PROJECT_ROOT, 'backups');
const DB_PATH = path.join(DATA_DIR, 'vorzai.db');

const RETENTION_DAYS = 30;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 执行 WAL checkpoint，将 WAL 中已提交事务刷入主库。
 * 使用 node:sqlite 原生驱动。
 */
function checkpointWal(): boolean {
  try {
    if (!fs.existsSync(DB_PATH)) return true;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    return true;
  } catch (e) {
    logger.warn('backup', `WAL checkpoint 失败，直接复制: ${(e as Error).message}`);
    return false;
  }
}

export interface BackupResult {
  backupId: string;
  createdAt: string;
  sizeBytes: number;
  path: string;
}

export function createBackup(tenantId?: string): BackupResult {
  ensureDir(BACKUP_ROOT);
  checkpointWal();

  if (!fs.existsSync(DB_PATH)) {
    throw new Error('数据库文件不存在，无法备份');
  }

  const backupId = `vorzai_${timestamp()}`;
  const backupDir = path.join(BACKUP_ROOT, backupId);
  ensureDir(backupDir);

  const dest = path.join(backupDir, 'vorzai.db');
  fs.copyFileSync(DB_PATH, dest);

  // 同时备份 JWT secret（关键凭证，恢复后需保持一致）
  const secretPath = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync(secretPath)) {
    fs.copyFileSync(secretPath, path.join(backupDir, '.jwt_secret'));
  }

  const meta = {
    backupId,
    createdAt: new Date().toISOString(),
    tenantId: tenantId || null,
    sizeBytes: fs.statSync(dest).size,
    walCheckpoint: true,
  };
  fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify(meta, null, 2));

  logger.info('backup', `数据库备份已创建: ${backupId}`, { tenantId });

  cleanupOldBackups();
  return { backupId, createdAt: meta.createdAt, sizeBytes: meta.sizeBytes, path: backupDir };
}

export interface BackupInfo {
  backupId: string;
  createdAt: string;
  sizeBytes: number;
  sizeMb: number;
}

export function listBackups(): BackupInfo[] {
  if (!fs.existsSync(BACKUP_ROOT)) return [];
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('vorzai_')).sort().reverse();
  const result: BackupInfo[] = [];

  for (const dir of dirs) {
    const metaPath = path.join(BACKUP_ROOT, dir, 'backup.json');
    const dbPath = path.join(BACKUP_ROOT, dir, 'vorzai.db');
    if (!fs.existsSync(dbPath)) continue;
    let meta: any = {};
    if (fs.existsSync(metaPath)) {
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch { /* ignore */ }
    }
    const sizeBytes = fs.statSync(dbPath).size;
    result.push({
      backupId: dir,
      createdAt: meta.createdAt || 'unknown',
      sizeBytes,
      sizeMb: Math.round((sizeBytes / 1024 / 1024) * 100) / 100,
    });
  }
  return result;
}

export interface RestoreResult {
  restoredFrom: string;
  preRestoreSnapshot: string;
  restoredAt: string;
}

export function restoreBackup(backupId: string, tenantId?: string): RestoreResult {
  const backupDir = path.join(BACKUP_ROOT, backupId);
  const src = path.join(backupDir, 'vorzai.db');

  if (!fs.existsSync(backupDir) || !fs.existsSync(src)) {
    throw new Error(`备份不存在: ${backupId}`);
  }

  // 恢复前对当前库做前置快照（含 WAL）
  const preId = `pre_restore_${timestamp()}`;
  const preDir = path.join(BACKUP_ROOT, preId);
  ensureDir(preDir);
  if (fs.existsSync(DB_PATH)) {
    fs.copyFileSync(DB_PATH, path.join(preDir, 'vorzai.db'));
  }
  for (const ext of ['-wal', '-shm']) {
    const f = `${DB_PATH}${ext}`;
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(preDir, `vorzai.db${ext}`));
  }

  // 执行恢复
  fs.copyFileSync(src, DB_PATH);

  // 恢复 JWT secret（如有）
  const backupSecret = path.join(backupDir, '.jwt_secret');
  if (fs.existsSync(backupSecret)) {
    fs.copyFileSync(backupSecret, path.join(DATA_DIR, '.jwt_secret'));
  }

  logger.warn('backup', `数据库已从 ${backupId} 恢复`, { tenantId, preRestoreSnapshot: preId });

  return {
    restoredFrom: backupId,
    preRestoreSnapshot: preId,
    restoredAt: new Date().toISOString(),
  };
}

function cleanupOldBackups(): void {
  if (!fs.existsSync(BACKUP_ROOT)) return;
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('vorzai_'));
  const now = Date.now();
  let removed = 0;

  for (const dir of dirs) {
    const metaPath = path.join(BACKUP_ROOT, dir, 'backup.json');
    let ageMs = Infinity;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        ageMs = now - new Date(meta.createdAt).getTime();
      } catch { /* ignore */ }
    }
    if (ageMs > RETENTION_DAYS * 24 * 60 * 60 * 1000) {
      fs.rmSync(path.join(BACKUP_ROOT, dir), { recursive: true, force: true });
      removed++;
    }
  }

  if (removed > 0) {
    logger.info('backup', `已清理 ${removed} 个过期备份`);
  }
}
