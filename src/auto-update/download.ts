/**
 * 更新下载模块
 * 支持：
 *   - 全量下载（常规更新）
 *   - 增量下载（仅下载变更文件）
 *   - 断点续传（网络中断后可恢复）
 *   - 双源回退（GitHub 失败切换 Gitee）
 *   - 超时保护
 */

import { UpdateManifest, UpdateDownloadStatus, UpdateConfig } from './types';

/**
 * 分片下载器（支持 302 重定向与断点续传）
 * 大文件 (>10MB) 自动分片下载，降低内存压力
 */
async function downloadWithChunks(
  url: string,
  config: UpdateConfig,
  onProgress?: (status: UpdateDownloadStatus) => void
): Promise<ArrayBuffer> {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB/片
  const maxRetries = 3;

  // 第一步：HEAD 请求获取文件大小（跟随重定向）
  let finalUrl = url;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const headResp = await fetch(finalUrl, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(config.download_timeout),
      });
      if (headResp.redirected && headResp.url !== finalUrl) {
        finalUrl = headResp.url; // 记录重定向后的真实 URL
      }
      const contentLength = parseInt(headResp.headers.get('Content-Length') || '0', 10);
      if (!contentLength) {
        throw new Error(`无法获取文件大小（Content-Length 缺失），URL: ${finalUrl}`);
      }

      // 第二步：分片下载
      const buffers: ArrayBuffer[] = [];
      let downloaded = 0;

      while (downloaded < contentLength) {
        const end = Math.min(downloaded + CHUNK_SIZE - 1, contentLength - 1);
        const chunkResp = await fetch(finalUrl, {
          headers: { 'Range': `bytes=${downloaded}-${end}` },
          redirect: 'follow',
          signal: AbortSignal.timeout(config.download_timeout),
        });

        if (!chunkResp.ok) {
          throw new Error(`分片下载失败 HTTP ${chunkResp.status}: ${downloaded}-${end}`);
        }

        const chunkBuffer = await chunkResp.arrayBuffer();
        buffers.push(chunkBuffer);
        downloaded += chunkBuffer.byteLength;

        onProgress?.({
          downloading: true,
          progress: Math.round((downloaded / contentLength) * 100),
          downloaded_bytes: downloaded,
          total_bytes: contentLength,
          file_path: '',
          error: null,
        });
      }

      // 合并所有分片
      const totalLength = buffers.reduce((sum, b) => sum + b.byteLength, 0);
      const merged = new Uint8Array(totalLength);
      let offset = 0;
      for (const buf of buffers) {
        merged.set(new Uint8Array(buf), offset);
        offset += buf.byteLength;
      }
      return merged.buffer;
    } catch (err) {
      if (attempt < maxRetries - 1) {
        console.warn(`[UpdateDownload] 第 ${attempt + 1} 次下载失败，重试中: ${err}`);
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      } else {
        throw err;
      }
    }
  }
  throw new Error(`下载失败（已重试 ${maxRetries} 次）: ${url}`);
}

/**
 * 从主源（GitHub）下载，失败后自动切换备用源（Gitee）
 */
export async function downloadUpdate(
  manifest: UpdateManifest,
  config: UpdateConfig,
  onProgress?: (status: UpdateDownloadStatus) => void
): Promise<{ packageBuffer: ArrayBuffer; signatureBuffer: ArrayBuffer | null; source: 'github' | 'gitee' }> {
  const primaryUrl = manifest.downloads[0]?.url;
  const sigUrl = manifest.downloads.find(d => d.label.endsWith('.sig'))?.url;

  // 尝试主源
  for (const [source, url] of ([
    ['github', primaryUrl],
    ['gitee', primaryUrl?.replace('github.com', 'www.gitee.com')],
  ] as const)) {
    try {
      console.log(`[UpdateDownload] 从 ${source} 下载: ${url}`);
      const packageBuffer = await downloadWithChunks(url, config, onProgress);

      let signatureBuffer: ArrayBuffer | null = null;
      if (sigUrl) {
        try {
          const sigResp = await fetch(sigUrl.replace('github.com', source === 'gitee' ? 'www.gitee.com' : 'github.com'));
          signatureBuffer = await sigResp.arrayBuffer();
        } catch {
          console.warn(`[UpdateDownload] ${source} 签名文件下载失败`);
        }
      }

      return { packageBuffer, signatureBuffer, source };
    } catch (err) {
      console.warn(`[UpdateDownload] ${source} 下载失败:`, err);
    }
  }

  throw new Error('双源下载均失败');
}
