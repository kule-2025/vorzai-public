/**
 * 平台凭据加密模块
 *
 * 安全口径（与 config.ts 的 JWT 密钥落盘策略保持一致）：
 *  - 算法：AES-256-GCM（带认证标签，篡改可检测）
 *  - 密钥：优先读环境变量 VORZAI_CRED_KEY；否则首次运行随机生成 256bit 并以 0600 权限落盘
 *  - 密文格式：v1:<iv-base64>:<tag-base64>:<ciphertext-base64>，带版本前缀便于后续轮换算法
 *  - 明文密钥只在内存中短暂存在，任何 HTTP 响应都必须走 maskSecret / hasSecret 脱敏
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const CIPHER_ALGO = 'aes-256-gcm';
const CIPHER_VERSION = 'v1';
const IV_LENGTH = 12; // GCM 推荐 96bit IV

let cachedKey: Buffer | null = null;

/** 获取（或首次生成）凭据加密主密钥 */
function getMasterKey(): Buffer {
  if (cachedKey) return cachedKey;

  const envKey = process.env.VORZAI_CRED_KEY;
  if (envKey && envKey.length >= 32) {
    // 环境变量提供的口令统一经 SHA-256 收敛为 32 字节
    cachedKey = crypto.createHash('sha256').update(envKey).digest();
    return cachedKey;
  }

  const keyDir = path.dirname(config.db.path);
  const keyPath = path.join(keyDir, '.platform_cred_key');

  try {
    if (fs.existsSync(keyPath)) {
      const hex = fs.readFileSync(keyPath, 'utf-8').trim();
      if (hex.length === 64) {
        cachedKey = Buffer.from(hex, 'hex');
        return cachedKey;
      }
    }
  } catch {
    // 落盘不可读时走下方重新生成分支
  }

  const generated = crypto.randomBytes(32);
  try {
    if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
    fs.writeFileSync(keyPath, generated.toString('hex'), { mode: 0o600 });
  } catch {
    logger.warn('platform', '凭据密钥无法落盘，本次进程使用内存密钥（重启后已存凭据将无法解密）');
  }
  cachedKey = generated;
  return cachedKey;
}

/** 加密明文凭据；空值原样返回 null，避免在库里留下无意义密文 */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain === null || plain === undefined || plain === '') return null;
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(CIPHER_ALGO, getMasterKey(), iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${CIPHER_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
  } catch (e) {
    logger.error('platform', `凭据加密失败: ${String(e)}`);
    throw new Error('凭据加密失败，请检查运行环境的加密支持');
  }
}

/** 解密凭据；解密失败返回 null（不抛错，避免一条坏数据阻断整个连接列表） */
export function decryptSecret(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  const parts = cipherText.split(':');
  if (parts.length !== 4 || parts[0] !== CIPHER_VERSION) {
    logger.warn('platform', '凭据密文格式不识别，已跳过解密');
    return null;
  }
  try {
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const data = Buffer.from(parts[3], 'base64');
    const decipher = crypto.createDecipheriv(CIPHER_ALGO, getMasterKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch (e) {
    logger.warn('platform', `凭据解密失败（密钥变更或密文损坏）: ${String(e)}`);
    return null;
  }
}

/**
 * 脱敏展示：只保留前 4 位，其余以 **** 代替。
 * 用于 API 响应，任何情况下都不回传明文密钥。
 */
export function maskSecret(cipherText: string | null | undefined): string | null {
  if (!cipherText) return null;
  const plain = decryptSecret(cipherText);
  if (!plain) return '****';
  if (plain.length <= 4) return '****';
  return `${plain.slice(0, 4)}****`;
}

/** 明文直接脱敏（用于 app_key 这类明文落库字段） */
export function maskPlain(plain: string | null | undefined): string | null {
  if (!plain) return null;
  if (plain.length <= 4) return '****';
  return `${plain.slice(0, 4)}****`;
}

/** 是否已配置该密钥（响应中用布尔值代替密文） */
export function hasSecret(cipherText: string | null | undefined): boolean {
  return !!cipherText;
}

// ────────────────── 买家隐私脱敏（订单归一化时使用） ──────────────────

/** 手机号脱敏：13812341234 → 138****1234；国际号码保留前 3 后 4 */
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = String(phone).replace(/\s|-/g, '');
  if (digits.length < 7) return '***';
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/** 姓名脱敏：张三丰 → 张**；John Smith → J*** S*** */
export function maskName(name: string | null | undefined): string | null {
  if (!name) return null;
  const trimmed = String(name).trim();
  if (!trimmed) return null;
  if (/^[\u4e00-\u9fa5]+$/.test(trimmed)) {
    return trimmed.length === 1 ? trimmed : trimmed[0] + '*'.repeat(trimmed.length - 1);
  }
  return trimmed
    .split(/\s+/)
    .map((seg) => (seg.length <= 1 ? seg : `${seg[0]}***`))
    .join(' ');
}

/** 邮箱脱敏：buyer@example.com → bu***@example.com */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = String(email).indexOf('@');
  if (at <= 0) return '***';
  const local = String(email).slice(0, at);
  const domain = String(email).slice(at);
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}***${domain}`;
}

/**
 * 地址脱敏：保留省市区，详细门牌以 * 替代。
 * 例：广东省深圳市南山区科技园路 1 号 A 栋 501 → 广东省深圳市南山区****
 */
export function maskAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const text = String(address).trim();
  if (!text) return null;
  const m = text.match(/^(.*?(?:区|县|市辖区|旗|镇))/);
  if (m && m[1] && m[1].length < text.length) {
    return `${m[1]}****`;
  }
  // 无法识别行政区划时，保留前 1/3 内容
  const keep = Math.max(4, Math.floor(text.length / 3));
  return `${text.slice(0, keep)}****`;
}
