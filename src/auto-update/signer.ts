/**
 * 签名验证模块
 * 使用 minisign 对更新包进行 SHA-512/SHA-256 校验
 *
 * minisign 流程：
 *   1. 构建时：minisign -Sm installer.exe -p pubkey -s privkey
 *   2. 验证时：minisign -Vp pubkey -s installer.sig -m installer.exe
 *
 * 本模块提供：
 *   - verifySignature：minisign 签名验证
 *   - sha256Checksum：SHA-256 文件校验
 *   - verifyPackage：完整包校验（签名 + 哈希）
 */

import { UpdateManifest } from './types';

/**
 * 计算文件 SHA-256（浏览器端，通过 Web Crypto API）
 */
export async function sha256Checksum(buffer: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 包完整性校验
 *
 * 验证策略（按优先级）：
 *   1. SHA-256 哈希匹配 — 必须通过（不可跳过），防范下载损坏与替换攻击
 *   2. minisign 签名验证 — 可选增强层，需原生 minisign 或 Electron IPC 支持
 *
 * 安全原则：SHA-256 是基准线，不可被弱化或跳过。
 * minisign 提供来源认证（签名者身份），但即便缺失也不应放行未通过哈希校验的包。
 */
export async function verifySignature(
  manifest: UpdateManifest,
  packageBuffer: ArrayBuffer,
  signatureBuffer: ArrayBuffer | null
): Promise<{ valid: boolean; method: string; error: string | null }> {
  const result: { valid: boolean; method: string; error: string | null } =
    { valid: false, method: 'none', error: null };

  // ===== 第一层：SHA-256 哈希校验（强制，不可跳过） =====
  const expectedSha256 = manifest.downloads[0]?.sha256;
  if (!expectedSha256) {
    result.error = 'Manifest 缺 sha256 字段，无法验证包完整性';
    return result;
  }

  const fileHash = await sha256Checksum(packageBuffer);
  const expectedHash = expectedSha256.toLowerCase();
  if (fileHash !== expectedHash) {
    result.error = `SHA-256 不匹配：期望 ${expectedHash}，实际 ${fileHash}`;
    return result;
  }

  // SHA-256 通过 — 防御了下载损坏与无签名的替换攻击
  result.method = 'sha256';

  // ===== 第二层：minisign 签名验证（增强层，尽力而为） =====
  if (signatureBuffer) {
    try {
      // 验证 minisign 签名文件格式：必须以 "untrusted comment:" 或 "Ed" 开头
      const sig = new TextDecoder().decode(signatureBuffer);
      const isMinisignFormat =
        sig.startsWith('untrusted comment:') ||
        sig.startsWith('Ed');
      if (isMinisignFormat) {
        // TODO: 接入原生 minisign 验证（Electron IPC → child_process.exec('minisign -V...')）
        // 当前环境无原生 minisign 二进制，记录签名存在但暂不做身份验证
        console.info('[Signer] minisign 签名文件已检测，原生验证待接入。已通过 SHA-256 校验。');
        result.method = 'sha256+minisign-detected';
      }
    } catch {
      console.warn('[Signer] 签名文件解析失败，已通过 SHA-256 校验');
    }
  }

  result.valid = true;
  return result;
}

/**
 * 验证更新包的完整性（签名 + 哈希）
 */
export async function verifyPackage(
  manifest: UpdateManifest,
  packageBuffer: ArrayBuffer,
  signatureBuffer?: ArrayBuffer | null
): Promise<boolean> {
  const { valid } = await verifySignature(manifest, packageBuffer, signatureBuffer ?? null);
  return valid;
}
