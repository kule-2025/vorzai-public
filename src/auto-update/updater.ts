/**
 * Updater 主控制器
 * 启动时自动检查更新，后台下载，下次启动自动应用
 *
 * 生命周期：
 *   1. App 启动 → checkForUpdate()
 *   2. 有新版本 → downloadUpdate()（后台）
 *   3. 下载完成 → 验证签名 → 写入 pending 目录
 *   4. 下次启动 → 检测到 pending → applyUpdate()
 *   5. 应用失败 → 回滚到 rollback_version
 */

import { checkForUpdate } from './check';
import { verifyPackage } from './signer';
import { downloadUpdate } from './download';
import {
  UpdateManifest, UpdateConfig, UpdateApplyResult,
  UPDATE_ENDPOINTS,
} from './types';

const PENDING_DIR = 'updates/pending/';
const ROLLBACK_DIR = 'updates/rollback/';
const INSTALLED_VERSION_KEY = 'vorzai_update_installed_version';
const PENDING_MANIFEST_KEY = 'vorzai_update_pending_manifest';

/**
 * 获取当前应用版本
 */
function getAppVersion(): string {
  try {
    const api = window.electronAPI;
    if (api && typeof api.getAppVersion === 'function') {
      return api.getAppVersion();
    }
  } catch { /* fallback */ }
  return import.meta.env.VITE_APP_VERSION || '0.1.1';
}

/**
 * 应用更新：将 pending 目录的安装包移动到目标位置并重启
 */
export async function applyUpdate(
  manifest: UpdateManifest
): Promise<UpdateApplyResult> {
  const pendingPath = `${PENDING_DIR}${manifest.version}.exe`;
  const rollbackPath = `${ROLLBACK_DIR}${manifest.version}.exe`;

  try {
    // 备份当前版本
    const currentExePath = window.electronAPI?.getApplicationPath?.();
    if (currentExePath && window.electronAPI?.fileWrite) {
      await window.electronAPI.fileWrite(
        `${ROLLBACK_DIR}current-backup.exe`,
        currentExePath
      );
    }

    // 移动安装包到目标位置
    if (window.electronAPI?.fileMove) {
      await window.electronAPI.fileMove(pendingPath, 'vorzai-ecommerce.exe');
    }

    // 记录安装版本
    localStorage.setItem(INSTALLED_VERSION_KEY, manifest.version);

    // 清理 pending
    if (window.electronAPI?.fileDelete) {
      await window.electronAPI.fileDelete(pendingPath);
    }

    // 触发重启（E-004: 优雅退出 — relaunch 后不再执行后续代码）
    if (window.electronAPI?.windowRelaunch) {
      window.electronAPI.windowRelaunch();
      // 等待 relaunch 后主动关闭当前窗口，避免僵尸进程
      setTimeout(() => {
        (window as any).electronAPI?.windowClose?.();
      }, 1000);
    }

    return {
      success: true,
      installed_version: manifest.version,
      rollback_occurred: false,
      error: null,
    };
  } catch (err) {
    // 应用失败 → 回滚
    try {
      if (window.electronAPI?.fileMove) {
        await window.electronAPI.fileMove(rollbackPath, 'vorzai-ecommerce.exe');
      }
      if (window.electronAPI?.windowRelaunch) {
        window.electronAPI.windowRelaunch();
        setTimeout(() => {
          (window as any).electronAPI?.windowClose?.();
        }, 1000);
      }
      return {
        success: false,
        installed_version: manifest.version,
        rollback_occurred: true,
        error: `更新失败，已回滚: ${err}`,
      };
    } catch (rollbackErr) {
      return {
        success: false,
        installed_version: 'unknown',
        rollback_occurred: false,
        error: `更新失败且回滚失败: ${err}; 回滚: ${rollbackErr}`,
      };
    }
  }
}

/**
 * 启动时更新检查流程（无感模式）
 */
export async function startupUpdateCheck(config: UpdateConfig): Promise<void> {
  const currentVersion = getAppVersion();

  // 先检查是否有待应用的更新
  const pendingManifest = localStorage.getItem(PENDING_MANIFEST_KEY);
  if (pendingManifest) {
    try {
      const manifest = JSON.parse(pendingManifest) as UpdateManifest;
      console.info('[Updater] 检测到待应用更新:', manifest.version);
      await applyUpdate(manifest);
      return;
    } catch {
      localStorage.removeItem(PENDING_MANIFEST_KEY);
    }
  }

  // 检查远程更新
  if (!config.check_on_startup) return;

  try {
    const result = await checkForUpdate(config, currentVersion);

    if (!result.available) {
      console.info('[Updater] 无可用更新，当前版本:', currentVersion);
      return;
    }

    const update = result.update!;
    console.log(`[Updater] 发现新版本 ${update.version}，来源: ${result.source}`);

    // 后台下载（无感模式：不弹 UI，下载完成后写入 pending）
    if (config.auto_apply) {
      try {
        const { packageBuffer, signatureBuffer, source } = await downloadUpdate(
          update, config,
          (status) => console.log(`[Updater] 下载进度: ${status.progress}%`)
        );

        // 验证签名
        const valid = await verifyPackage(update, packageBuffer, signatureBuffer);
        if (!valid) {
          console.error('[Updater] 签名验证失败，放弃更新');
          return;
        }

        // 写入 pending 目录
        const pendingPath = `${PENDING_DIR}${update.version}.exe`;
        if (window.electronAPI?.fileWrite) {
          await window.electronAPI.fileWrite(pendingPath, packageBuffer);
        }

        // 记录待应用清单
        localStorage.setItem(PENDING_MANIFEST_KEY, JSON.stringify(update));

        console.info(`[Updater] 更新 ${update.version} 已下载，下次启动自动应用`);
      } catch (err) {
        console.warn('[Updater] 下载失败（双源已尝试）:', err);
      }
    } else {
      // 不自动应用：仅记录版本信息
      localStorage.setItem('vorzai_update_available', JSON.stringify(update));
    }
  } catch (err) {
    console.error('[Updater] 启动检查异常:', err);
  }
}

/**
 * 手动触发更新检查（用户点击"检查更新"按钮时调用）
 */
export async function manualUpdateCheck(
  config: UpdateConfig
): Promise<{ available: boolean; version: string | null; source: string | null }> {
  const currentVersion = getAppVersion();
  const result = await checkForUpdate(config, currentVersion);
  return {
    available: result.available,
    version: result.update?.version || null,
    source: result.source,
  };
}
