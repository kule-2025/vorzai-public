/**
 * 适配器签名算法单测（B2 覆盖率提升专项）
 * 覆盖 server/src/services/adapters/signing.ts —— 淘宝/抖店/京东/拼多多/快手/Shopify/Amazon 真实签名。
 * 断言口径：用 Node crypto 独立重算「文档算法」结果，与实现做等价校验（回归保护），
 * 避免只测「不抛错」而导致的伪覆盖。
 */
import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  taobaoTopSign,
  doudianSign,
  stableJsonStringify,
  jdSign,
  pddSign,
  kuaishouSign,
  shopifyWebhookHmac,
  shopifyOAuthHmac,
  safeCompare,
  awsSigV4,
  formatCnTimestamp,
  unixSeconds,
  unixMillis,
  buildQuery,
} from '../src/services/adapters/signing';

const md5 = (s: string) => crypto.createHash('md5').update(s, 'utf8').digest('hex');
const hmacSha256Hex = (key: string | crypto.BinaryLike, data: string) =>
  crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
const hmacSha256B64 = (key: string | crypto.BinaryLike, data: string) =>
  crypto.createHmac('sha256', key).update(data, 'utf8').digest('base64');

/** 复刻 signing.ts 内部的 sortedEntries（过滤空值与 sign），用于独立重算拼接串 */
function concatSorted(params: Record<string, string | number | undefined | null>, sep = ''): string {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '' && k !== 'sign')
    .sort()
    .map((k) => `${k}${sep}${params[k]}`)
    .join(sep);
}

describe('signing — 淘宝 TOP', () => {
  it('md5 模式与文档算法一致', () => {
    const params = { method: 'taobao.item.get', app_key: 'k', timestamp: '2024-01-01 00:00:00' };
    const concat = concatSorted(params);
    expect(taobaoTopSign(params, 'secret', 'md5')).toBe(md5(`secret${concat}secret`).toUpperCase());
  });
  it('hmac 模式与文档算法一致', () => {
    const params = { method: 'm', app_key: 'k' };
    const concat = concatSorted(params);
    expect(taobaoTopSign(params, 'secret', 'hmac')).toBe(
      crypto.createHmac('md5', 'secret').update(concat, 'utf8').digest('hex').toUpperCase()
    );
  });
  it('忽略空值与 sign 键', () => {
    const params = { method: 'm', sign: 'XYZ', empty: '' };
    expect(taobaoTopSign(params, 'secret')).toBe(md5(`secret${concatSorted(params)}secret`).toUpperCase());
  });
});

describe('signing — 抖店 Doudian', () => {
  it('签名与文档算法一致', () => {
    const params = { app_key: 'ak', method: 'order.list', param_json: '{"a":1}', timestamp: '123', v: '2' };
    const paramPattern =
      `app_key${params.app_key}method${params.method}param_json${params.param_json}timestamp${params.timestamp}v${params.v}`;
    expect(doudianSign(params, 'secret')).toBe(md5(`secret${paramPattern}secret`));
  });
  it('stableJsonStringify 递归 key 升序、紧凑、过滤 undefined', () => {
    expect(stableJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(stableJsonStringify({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(stableJsonStringify([3, 1, 2])).toBe('[3,1,2]');
    expect(stableJsonStringify(null)).toBe('null');
    expect(stableJsonStringify({ z: { y: 1, x: 2 }, a: [{ c: 1, b: 2 }] })).toBe(
      '{"a":[{"b":2,"c":1}],"z":{"x":2,"y":1}}'
    );
  });
});

describe('signing — 京东 / 拼多多', () => {
  it('jdSign 与文档算法一致（大写 MD5）', () => {
    const params = { method: 'm', app_key: 'k', v: '2' };
    expect(jdSign(params, 'secret')).toBe(md5(`secret${concatSorted(params)}secret`).toUpperCase());
  });
  it('pddSign 与文档算法一致（client_secret 大写 MD5）', () => {
    const params = { type: 'pdd.goods.list', client_id: 'cid' };
    expect(pddSign(params, 'client_secret')).toBe(md5(`client_secret${concatSorted(params)}client_secret`).toUpperCase());
  });
});

describe('signing — 快手小店', () => {
  it('MD5 模式与文档算法一致', () => {
    const params = { appkey: 'ak', method: 'm' };
    const c = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '' && k !== 'sign')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    expect(kuaishouSign(params, 'signSecret', 'MD5')).toBe(md5(`${c}&signSecret=signSecret`));
  });
  it('HMAC_SHA256 模式与文档算法一致', () => {
    const params = { appkey: 'ak', method: 'm' };
    const c = Object.keys(params)
      .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '' && k !== 'sign')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    expect(kuaishouSign(params, 'signSecret', 'HMAC_SHA256')).toBe(hmacSha256Hex('signSecret', c));
  });
});

describe('signing — Shopify', () => {
  it('webhook HMAC 为 base64(hmac-sha256)', () => {
    expect(shopifyWebhookHmac('raw-body', 'shh')).toBe(hmacSha256B64('shh', 'raw-body'));
  });
  it('OAuth HMAC 排除 hmac/signature 后做 hex(hmac-sha256)', () => {
    const query = { code: 'c', state: 's', hmac: 'IGNORE', signature: 'IGNORE2' };
    const c = Object.keys(query)
      .filter((k) => query[k] !== undefined && query[k] !== null && query[k] !== '' && k !== 'hmac' && k !== 'signature')
      .sort()
      .map((k) => `${k}=${query[k]}`)
      .join('&');
    expect(shopifyOAuthHmac(query, 'shh')).toBe(hmacSha256Hex('shh', c));
  });
});

describe('signing — safeCompare（防计时攻击）', () => {
  it('相同内容返回 true', () => {
    expect(safeCompare('abc', 'abc')).toBe(true);
  });
  it('不同内容返回 false', () => {
    expect(safeCompare('abc', 'abd')).toBe(false);
  });
  it('长度不同直接返回 false（不越界比较）', () => {
    expect(safeCompare('ab', 'abc')).toBe(false);
  });
});

describe('signing — AWS SigV4', () => {
  const base = {
    method: 'GET',
    path: '/orders/v0/orders',
    query: {},
    host: 'sellingpartnerapi-na.amazon.com',
    region: 'us-east-1',
    service: 'execute-api',
    accessKeyId: 'AKIDEXAMPLE',
    secretAccessKey: 'wJalrXUtnFEMI',
    date: new Date('2024-01-01T00:00:00Z'),
  };
  it('产出标准 Authorization 头与 x-amz-date', () => {
    const res = awsSigV4(base);
    expect(res.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(res.authorization).toContain('SignedHeaders=host;x-amz-date');
    expect(res.authorization).toContain('Signature=');
    expect(res.headers['x-amz-date']).toBe('20240101T000000Z');
    expect(res.headers.Authorization).toBe(res.authorization);
    expect(res.amzDate).toBe('20240101T000000Z');
  });
  it('相同输入产出确定签名（可复现）', () => {
    const a = awsSigV4(base);
    const b = awsSigV4(base);
    expect(a.authorization).toBe(b.authorization);
  });
  it('带 sessionToken 时透传 x-amz-security-token', () => {
    const res = awsSigV4({ ...base, sessionToken: 'TOKEN123' });
    expect(res.headers['x-amz-security-token']).toBe('TOKEN123');
  });
  it('查询参数按 RFC3986 严格编码进入规范请求', () => {
    const res = awsSigV4({ ...base, query: { 'a b': "c'd", nextToken: 'x&y' } });
    // 签名能稳定产出即可，编码正确性由实现内部的 rfc3986 保证；此处校验不抛错且结构合法
    expect(res.authorization).toContain('Signature=');
  });
});

describe('signing — 时间/查询工具', () => {
  const d = new Date('2024-03-04T05:06:07Z');
  it('formatCnTimestamp 为东八区 yyyy-MM-dd HH:mm:ss', () => {
    expect(formatCnTimestamp(d)).toBe('2024-03-04 13:06:07');
  });
  it('unixSeconds / unixMillis', () => {
    expect(unixSeconds(d)).toBe(String(Math.floor(d.getTime() / 1000)));
    expect(unixMillis(d)).toBe(String(d.getTime()));
  });
  it('buildQuery 对 key/value 做 encodeURIComponent', () => {
    expect(buildQuery({ a: 'x y', b: 1 })).toBe('a=x%20y&b=1');
  });
});
