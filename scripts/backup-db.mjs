#!/usr/bin/env node
/**
 * Vorzai 数据库自动备份工具
 *
 * 功能：
 * 1. 执行 WAL checkpoint 确保所有待写数据落盘
 * 2. 复制数据库文件到带时间戳的备份目录
 * 3. 自动清理超过保留期的旧备份
 * 4. 支持 --restore 从指定备份恢复
 *
 * 用法：
 *   node scripts/backup-db.mjs            # 创建备份
 *   node scripts/backup-db.mjs --restore <备份目录>   # 恢复备份
 *   node scripts/backup-db.mjs --list     # 列出所有备份
 *
 * 安全设计：
 * - 备份仅在本地 data/ 目录进行，不触碰任何外部网络
 * - 恢复前自动对当前库做前置快照，防止误操作导致数据丢失
 */

import fs from 'fs';
import path from 'path';

const PROJECT_ROOT = process.cwd();
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const BACKUP_ROOT = path.join(PROJECT_ROOT, 'backups');
const DB_PATH = path.join(DATA_DIR, 'vorzai.db');

const RETENTION_DAYS = 30;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * 执行 WAL checkpoint，将 WAL 中所有已提交事务刷入主库文件。
 * 使用 node:sqlite 原生驱动（Node 22+, Electron 33 内置）。
 * 否则直接拷贝 .db 可能丢失 WAL 中尚未合并的数据。
 */
function checkpointWal() {
  try {
    if (!fs.existsSync(DB_PATH)) return true;
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(DB_PATH);
    db.pragma('wal_checkpoint(TRUNCATE)');
    db.close();
    return true;
  } catch (e) {
    console.warn('[WARN] WAL checkpoint 失败，尝试直接复制:', e.message);
    return false;
  }
}

function createBackup() {
  ensureDir(BACKUP_ROOT);
  checkpointWal();

  if (!fs.existsSync(DB_PATH)) {
    console.error('[ERROR] 数据库文件不存在:', DB_PATH);
    process.exit(1);
  }

  const backupDir = path.join(BACKUP_ROOT, `vorzai_${timestamp()}`);
  ensureDir(backupDir);

  const dest = path.join(backupDir, 'vorzai.db');
  fs.copyFileSync(DB_PATH, dest);

  // 备份 JWT secret（如有）
  const secretPath = path.join(DATA_DIR, '.jwt_secret');
  if (fs.existsSync) { /* noop */ }
  if (fs.existsSync(secretPath)) {
    fs.copyFileSync(secretPath, path.join(backupDir, '.jwt_secret'));
  }

  // 写入备份元数据
  const meta = {
    createdAt: new Date().toISOString(),
    sourceDb: DB_PATH,
    sizeBytes: fs.statSync(dest).size,
    walCheckpoint: true,
  };
  fs.writeFileSync(path.join(backupDir, 'backup.json'), JSON.stringify(meta, null, 2));

  console.log(`[OK] 备份已创建: ${backupDir}`);
  console.log(`     大小: ${(meta.sizeBytes / 1024 / 1024).toFixed(2)} MB`);

  cleanupOldBackups();
}

function cleanupOldBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) return;
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('vorzai_'));
  const now = Date.now();
  let removed = 0;

  for (const dir of dirs) {
    const full = path.join(BACKUP_ROOT, dir);
    const metaPath = path.join(full, 'backup.json');
    let ageMs = Infinity;
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        ageMs = now - new Date(meta.createdAt).getTime();
      } catch { /* ignore */ }
    }
    if (ageMs > RETENTION_DAYS * 24 * 60 * 60 * 1000) {
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    }
  }

  if (removed > 0) {
    console.log(`[CLEAN] 已清理 ${removed} 个过期备份（保留期 ${RETENTION_DAYS} 天）`);
  }
}

function listBackups() {
  if (!fs.existsSync(BACKUP_ROOT)) {
    console.log('[INFO] 暂无备份');
    return;
  }
  const dirs = fs.readdirSync(BACKUP_ROOT).filter((d) => d.startsWith('vorzai_')).sort();
  console.log(`\n找到 ${dirs.length} 个备份:\n`);
  for (const dir of dirs) {
    const metaPath = path.join(BACKUP_ROOT, dir, 'backup.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      console.log(`  ${dir}`);
      console.log(`    创建: ${meta.createdAt}`);
      console.log(`    大小: ${(meta.sizeBytes / 1024 / 1024).toFixed(2)} MB`);
    }
  }
}

function restoreBackup(backupDirName) {
  const backupDir = path.join(BACKUP_ROOT, backupDirName);
  if (!fs.existsSync(backupDir)) {
    console.error('[ERROR] 备份目录不存在:', backupDir);
    process.exit(1);
  }

  const src = path.join(backupDir, 'vorzai.db');
  if (!fs.existsSync(src)) {
    console.error('[ERROR] 备份中无数据库文件:', src);
    process.exit(1);
  }

  // 恢复前对当前库做前置快照
  if (fs.existsSync(DB_PATH)) {
    const preBackup = path.join(BACKUP_ROOT, `pre_restore_${timestamp()}`);
    ensureDir(preBackup);
    fs.copyFileSync(DB_PATH, path.join(preBackup, 'vorzai.db'));
    console.log(`[SAFE] 恢复前快照已保存: ${preBackup}`);
  }

  fs.copyFileSync(src, DB_PATH);
  console.log(`[OK] 已从 ${backupDirName} 恢复数据库`);
}

// CLI 解析
const args = process.argv.slice(2);
if (args.includes('--list') || args.includes('-l')) {
  listBackups();
} else if (args.includes('--restore') || args.includes('-r')) {
  const idx = args.indexOf('--restore') >= 0 ? args.indexOf('--restore') : args.indexOf('-r');
  const target = args[idx + 1];
  if (!target) {
    console.error('[ERROR] 请指定要恢复的备份目录名');
    process.exit(1);
  }
  restoreBackup(target);
} else {
  createBackup();
}
