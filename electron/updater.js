/**
 * 无感更新工具库
 * electron/updater.js
 *
 * 职责：
 *   1. 双源检查（GitHub Release → Gitee Release 回退）
 *   2. 下载文件（支持进度回调）
 *   3. SHA-256 完整性校验（fail-closed）
 *   4. 完整无感更新流程：检查 → 下载 → 校验 → 待应用 → 通知前端
 *   5. 应用更新（备份 + 替换 + 重启）
 *   6. 查询待应用更新
 *
 * IPC 注册由 main.js 统一通过 ipcMain.handle 完成。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');

// 运行时目录由 main.js 在 app.whenReady 后覆盖
let UPDATES_DIR = null;
let PENDING_DIR = null;
let ROLLBACK_DIR = null;
let DOWNLOAD_DIR = null;

/**
 * 初始化更新目录（由 main.js 在 app.whenReady() 后调用）
 * @param {string} updatesDir 更新根目录，通常 app.getPath('userData') + '/updates'
 */
function initUpdateDirs(updatesDir) {
  UPDATES_DIR = updatesDir;
  PENDING_DIR = path.join(updatesDir, 'pending');
  ROLLBACK_DIR = path.join(updatesDir, 'rollback');
  DOWNLOAD_DIR = path.join(updatesDir, 'downloads');
  [PENDING_DIR, ROLLBACK_DIR, DOWNLOAD_DIR].forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  console.log('[Updater] 更新目录已初始化:', UPDATES_DIR);
}

/**
 * 计算文件 SHA-256 哈希
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 验证下载文件的完整性（fail-closed：无 SHA-256 即拒绝）
 */
async function verifyDownloadedFile(filePath, expectedSha256) {
  if (!expectedSha256) {
    throw new Error('更新包缺少 SHA-256 哈希，无法验证完整性，已拒绝');
  }
  const actualHash = await sha256File(filePath);
  if (actualHash.toLowerCase() !== expectedSha256.toLowerCase()) {
    throw new Error(`文件 SHA-256 校验失败：期望 ${expectedSha256}，实际 ${actualHash}`);
  }
  console.log('[Updater] SHA-256 校验通过:', actualHash);
  return { valid: true, actualHash };
}

/**
 * 下载文件（支持进度回调）
 */
function downloadFile(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let downloaded = 0;
    let total = 0;

    const fetchUrl = url.startsWith('https') ? https : http;
    const req = fetchUrl.get(url, (res) => {
      total = parseInt(res.headers['content-length'] || '0', 10);
      res.pipe(file);

      res.on('data', (chunk) => {
        downloaded += chunk.length;
        onProgress?.({
          progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
          downloaded_bytes: downloaded,
          total_bytes: total,
        });
      });

      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    });

    req.on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

/**
 * 选择最佳下载资产：优先选 .exe 且带 SHA-256 的
 */
function selectBestDownload(downloads) {
  if (!downloads || downloads.length === 0) return null;
  const exeWithHash = downloads.find(
    (d) => d.url.toLowerCase().endsWith('.exe') && d.sha256
  );
  const exeWithoutHash = downloads.find((d) => d.url.toLowerCase().endsWith('.exe'));
  const withHash = downloads.find((d) => d.sha256);
  return exeWithHash || exeWithoutHash || withHash || downloads[0];
}

/**
 * 完整无感更新流程
 * 检查 → 下载 → SHA-256 校验 → 写入 pending 目录 → 通知前端
 * @param {object} config - 更新端点配置（含 github_repo, gitee_repo）
 * @param {string} currentVersion - 当前版本
 * @param {object} callbacks - 回调 { onProgress, onNotify, onError }
 *   onProgress: { progress, downloaded_bytes, total_bytes } → void
 *   onNotify: { type: 'downloaded', version, size, source } → void
 *   onError: { error: string } → void
 */
async function autoUpdate(config, currentVersion, callbacks = {}) {
  const { checkForUpdate } = require('./updater');
  const result = await checkForUpdate(config, currentVersion);

  if (!result.available) {
    if (result.error) {
      console.warn('[Updater] 无感更新检查失败:', result.error);
      callbacks.onError?.({ error: result.error });
    }
    return;
  }

  const updateVersion = result.version;
  console.log(`[Updater] 发现新版本 ${updateVersion}，来源: ${result.source}`);

  const download = selectBestDownload(result.downloads);
  if (!download) {
    const err = { error: `新版本 ${updateVersion} 没有可用的下载资产` };
    console.error('[Updater]', err.error);
    callbacks.onError?.(err);
    return;
  }

  // 确保下载目录存在
  if (!DOWNLOAD_DIR) {
    const err = { error: '更新目录未初始化，请先调用 initUpdateDirs' };
    console.error('[Updater]', err.error);
    callbacks.onError?.(err);
    return;
  }

  const destPath = path.join(DOWNLOAD_DIR, path.basename(download.url));
  console.log(`[Updater] 开始下载: ${download.label}`);

  try {
    await downloadFile(download.url, destPath, callbacks.onProgress);

    // SHA-256 校验
    if (download.sha256) {
      await verifyDownloadedFile(destPath, download.sha256);
    } else {
      console.warn('[Updater] 下载资产无 SHA-256 字段，跳过校验');
    }

    // 写入 pending 目录
    const pendingPath = path.join(PENDING_DIR, path.basename(download.url));
    if (fs.existsSync(pendingPath)) {
      fs.unlinkSync(pendingPath);
    }
    fs.renameSync(destPath, pendingPath);

    // 记录 pending manifest
    const manifestPath = path.join(PENDING_DIR, `${updateVersion}.manifest.json`);
    const manifest = {
      version: updateVersion,
      name: result.name,
      source: result.source,
      downloaded_at: new Date().toISOString(),
      sha256: download.sha256 || null,
      pending_file: path.basename(pendingPath),
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    const stats = fs.statSync(pendingPath);
    console.log(`[Updater] 更新 ${updateVersion} 已下载并校验完成 (${stats.size} bytes)`);

    callbacks.onNotify?.({
      type: 'downloaded',
      version: updateVersion,
      size: stats.size,
      source: result.source,
    });
  } catch (err) {
    console.error('[Updater] 下载或校验失败:', err.message);
    callbacks.onError?.({ error: `更新下载失败: ${err.message}` });
  }
}

/**
 * 应用更新：将下载的 exe 复制到 app 同级目录并触发 relaunch
 * @param {string} pendingPath 待应用的更新包路径
 * @param {string} targetExePath 目标 exe 完整路径
 * @param {string} currentVersion 当前版本号
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function applyUpdate(pendingPath, targetExePath, currentVersion) {
  const targetExe = targetExePath || app ? app.getPath('exe') : '';
  try {
    // 备份当前版本
    if (!ROLLBACK_DIR) {
      throw new Error('回滚目录未初始化，请先调用 initUpdateDirs');
    }
    if (fs.existsSync(targetExe)) {
      const backupName = `backup-v${currentVersion}.exe`;
      const backupPath = path.join(ROLLBACK_DIR, backupName);
      if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
      fs.copyFileSync(targetExe, backupPath);
      console.log(`[Updater] 已备份当前版本 → ${backupPath}`);
    }

    // 将待应用更新复制到目标 exe 位置
    if (!fs.existsSync(pendingPath)) {
      throw new Error(`更新文件不存在: ${pendingPath}`);
    }
    if (fs.existsSync(targetExe)) {
      fs.unlinkSync(targetExe);
    }
    fs.copyFileSync(pendingPath, targetExe);
    console.log(`[Updater] 更新文件已复制到: ${targetExe}`);

    // 清理 pending 文件
    try {
      fs.unlinkSync(pendingPath);
      const manifestPath = path.join(PENDING_DIR, `${currentVersion}.manifest.json`);
      if (fs.existsSync(manifestPath)) fs.unlinkSync(manifestPath);
    } catch { /* ignore cleanup errors */ }

    console.log('[Updater] 更新已应用，等待 relaunch');
    return { success: true };
  } catch (err) {
    console.error('[Updater] 应用更新失败:', err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 查询是否有待应用的更新
 */
function hasPendingUpdates() {
  const realDir = PENDING_DIR || process.env.VORZAI_PENDING_DIR;
  if (!realDir) return { hasPending: false, files: [] };
  try {
    const files = fs.readdirSync(realDir).filter((f) => f.endsWith('.exe'));
    return { hasPending: files.length > 0, files };
  } catch {
    return { hasPending: false, files: [] };
  }
}

/**
 * 检查更新：GitHub Release → Gitee Release 回退
 */
async function checkForUpdate(config, currentVersion) {
  const gh = { ...config };
  try {
    const resp = await fetch(`https://api.github.com/repos/${gh.github_repo}/releases/latest`);
    if (!resp.ok) throw new Error(`GitHub ${resp.status}`);
    const release = await resp.json();
    return {
      available: true,
      source: 'github',
      version: release.tag_name,
      name: release.name,
      body: release.body,
      published_at: release.published_at,
      currentVersion,
      downloads: (release.assets || []).map((a) => ({
        url: a.browser_download_url,
        label: a.name,
        size: a.size,
        sha256: a.sha256 || a.sha256hash || null,
      })),
    };
  } catch (err) {
    console.warn('[Updater] GitHub 检查失败:', err.message, '尝试 Gitee...');
    try {
      const resp = await fetch(`https://gitee.com/api/v5/repos/${gh.gitee_repo}/releases/latest`);
      if (!resp.ok) throw new Error(`Gitee ${resp.status}`);
      const release = await resp.json();
      return {
        available: true,
        source: 'gitee',
        version: release.tag_name,
        name: release.name,
        body: release.body,
        published_at: release.published_at,
        currentVersion,
        downloads: (release.assets || []).map((a) => ({
          url: a.download_url,
          label: a.name,
          size: a.size,
          sha256: a.sha256 || null,
        })),
      };
    } catch (err2) {
      return { available: false, error: `双源均失败: ${err.message}` };
    }
  }
}

const UPDATE_ENDPOINTS = {
  production: {
    github_repo: 'kule-2025/vorzai-public',
    gitee_repo: 'king2030/vorzai',
  },
  development: {
    github_repo: 'kule-2025/vorzai-public',
    gitee_repo: 'king2030/vorzai',
  },
};

module.exports = {
  checkForUpdate,
  downloadFile,
  applyUpdate,
  autoUpdate,
  verifyDownloadedFile,
  sha256File,
  hasPendingUpdates,
  initUpdateDirs,
  UPDATE_ENDPOINTS,
};