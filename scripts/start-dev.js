#!/usr/bin/env node
/**
 * Vorzai 电商 Agent · 开发环境跨平台一键启动器
 * ────────────────────────────────────────────────
 * 行为：
 *   1. 检测 node_modules（首次自动 npm install）
 *   2. 并发启动 Vite（3000 端口）+ Electron（等 Vite 就绪）
 *   3. Ctrl+C 干净退出
 *
 * 用法：
 *   node scripts/start-dev.js
 *   npm start
 *   npm run start:dev
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IS_WIN = process.platform === 'win32';

function log(tag, msg) {
  const color = tag === 'VITE' ? '\x1b[34m' : tag === 'ELECTRON' ? '\x1b[35m' : '\x1b[36m';
  const reset = '\x1b[0m';
  console.log(`${color}[${tag}]${reset} ${msg}`);
}

function die(msg) {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
}

// ─── 1. 依赖检查 ───
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  log('SETUP', '首次启动，正在安装依赖（约 1~3 分钟）...');
  const install = spawn(IS_WIN ? 'npm.cmd' : 'npm', ['install'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  install.on('exit', (code) => {
    if (code !== 0) die('依赖安装失败，请检查网络后重试');
    start();
  });
} else {
  start();
}

function start() {
  log('SETUP', 'Vorzai 电商 Agent · 启动中 ...');
  log('SETUP', '提示：按 Ctrl+C 结束');

  // ─── 2. Vite ───
  const vite = spawn(IS_WIN ? 'npx.cmd' : 'npx', ['vite'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  vite.stdout.on('data', (d) => process.stdout.write(`\x1b[34m[VITE]\x1b[0m ${d}`));
  vite.stderr.on('data', (d) => process.stderr.write(`\x1b[34m[VITE]\x1b[0m ${d}`));

  // ─── 3. Electron（等 Vite 就绪） ───
  const waitAndElectron = (IS_WIN ? 'npx.cmd' : 'npx');
  const waitArgs = ['wait-on', 'http://localhost:3000', '--', IS_WIN ? 'electron.cmd' : 'electron', '.'];
  const electron = spawn(waitAndElectron, waitArgs, {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'development', ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  electron.stdout.on('data', (d) => process.stdout.write(`\x1b[35m[ELECTRON]\x1b[0m ${d}`));
  electron.stderr.on('data', (d) => process.stderr.write(`\x1b[35m[ELECTRON]\x1b[0m ${d}`));

  // ─── 4. 干净退出 ───
  const cleanup = () => {
    log('SETUP', '正在关闭 ...');
    try { vite.kill(); } catch {}
    try { electron.kill(); } catch {}
    setTimeout(() => process.exit(0), 500);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  electron.on('exit', (code) => {
    log('SETUP', `Electron 退出（code=${code}）`);
    cleanup();
  });
}
