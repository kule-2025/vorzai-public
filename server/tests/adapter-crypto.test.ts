/**
 * 平台凭据加密 / 隐私脱敏单测（B2 覆盖率提升专项）
 * 覆盖 server/src/services/adapters/crypto.ts —— AES-256-GCM 加解密、各类脱敏工具。
 */
import { describe, it, expect } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  maskPlain,
  hasSecret,
  maskPhone,
  maskName,
  maskEmail,
  maskAddress,
} from '../src/services/adapters/crypto';

describe('crypto — 凭据加解密（AES-256-GCM）', () => {
  it('空值原样返回 null，避免无意义密文', () => {
    expect(encryptSecret(null)).toBeNull();
    expect(encryptSecret(undefined)).toBeNull();
    expect(encryptSecret('')).toBeNull();
  });
  it('加密后仍可解密还原明文（同进程内主密钥一致）', () => {
    const plain = 'sk_live_abc123DEF456';
    const cipher = encryptSecret(plain);
    expect(cipher).not.toBeNull();
    expect(cipher).not.toContain(plain);
    expect(decryptSecret(cipher)).toBe(plain);
  });
  it('密文格式为 v1:<iv>:<tag>:<data> 四段', () => {
    const cipher = encryptSecret('hello') as string;
    const parts = cipher.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });
  it('格式不识别 / 版本不符返回 null 不抛错', () => {
    expect(decryptSecret('not-a-cipher')).toBeNull();
    expect(decryptSecret('v9:aaaa:bbbb:cccc')).toBeNull();
    expect(decryptSecret('')).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
  });
  it('密文被篡改（认证标签不匹配）返回 null', () => {
    const cipher = encryptSecret('topsecret') as string;
    const tampered = cipher.slice(0, -2) + (cipher.slice(-2) === 'AA' ? 'BB' : 'AA');
    expect(decryptSecret(tampered)).toBeNull();
  });
});

describe('crypto — 脱敏展示', () => {
  it('maskSecret 返回「前4位 + ****」且不泄露明文', () => {
    const cipher = encryptSecret('app_secret_xyz') as string;
    const masked = maskSecret(cipher);
    expect(masked).toBe('app_****');
    expect(masked).not.toContain('xyz');
  });
  it('maskSecret 对短明文 / 空值安全', () => {
    expect(maskSecret(encryptSecret('ab'))).toBe('****');
    expect(maskSecret(null)).toBeNull();
  });
  it('maskPlain 对明文落库字段脱敏', () => {
    expect(maskPlain('ak_123456')).toBe('ak_1****');
    expect(maskPlain('ab')).toBe('****');
    expect(maskPlain(null)).toBeNull();
  });
  it('hasSecret 仅判断是否存在密文', () => {
    expect(hasSecret('v1:aa:bb:cc')).toBe(true);
    expect(hasSecret(null)).toBe(false);
    expect(hasSecret('')).toBe(false);
  });
});

describe('crypto — 买家隐私脱敏', () => {
  it('maskPhone：保留前3后4', () => {
    expect(maskPhone('13812341234')).toBe('138****1234');
    expect(maskPhone('123')).toBe('***');
    expect(maskPhone(null)).toBeNull();
  });
  it('maskName：中文保留首字，英文按段保留首字母', () => {
    expect(maskName('张三丰')).toBe('张**');
    expect(maskName('单')).toBe('单');
    expect(maskName('John Smith')).toBe('J*** S***');
    expect(maskName(null)).toBeNull();
  });
  it('maskEmail：本地部分保留前2位', () => {
    expect(maskEmail('buyer@example.com')).toBe('bu***@example.com');
    expect(maskEmail('a@b.com')).toBe('a***@b.com');
    expect(maskEmail(null)).toBeNull();
  });
  it('maskAddress：保留到区/县，详细门牌以 **** 替代', () => {
    expect(maskAddress('广东省深圳市南山区科技园路1号A栋501')).toBe('广东省深圳市南山区****');
    expect(maskAddress('短地址')).toContain('****');
    expect(maskAddress(null)).toBeNull();
  });
});
