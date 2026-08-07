/**
 * 各电商开放平台的**真实签名算法**实现。
 *
 * 本文件是适配层最硬的资产：即便当前没有真实 AppKey 无法发起 live 调用，
 * 签名逻辑本身是按各平台公开文档实现的，一旦用户填入真实凭据即可直接生效。
 *
 * 覆盖：
 *  - 淘宝 TOP（MD5 / HMAC-MD5）
 *  - 抖店 Doudian（MD5，param_json 拼接式）
 *  - 京东宙斯（MD5，大写）
 *  - 拼多多（MD5，大写）
 *  - 快手小店（MD5 / HMAC-SHA256，signSecret 后缀式）
 *  - Shopify（HMAC-SHA256，webhook base64 / oauth hex）
 *  - Amazon SP-API（AWS Signature V4，service=execute-api）
 */
import crypto from 'crypto';

/** 参数字典（值统一转字符串后参与签名） */
export type SignParams = Record<string, string | number | undefined | null>;

/** 过滤空值并按 key 的 ASCII 升序排序 */
function sortedEntries(params: SignParams): Array<[string, string]> {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '' && k !== 'sign')
    .sort()
    .map((k) => [k, String(params[k])] as [string, string]);
}

function md5Hex(input: string): string {
  return crypto.createHash('md5').update(input, 'utf8').digest('hex');
}

// ────────────────── 淘宝 / 天猫 TOP ──────────────────

/**
 * 淘宝开放平台（TOP）签名。
 * 文档口径：
 *   1. 除 sign 外所有请求参数按 key 的 ASCII 升序排序
 *   2. 拼成 key1value1key2value2... 字符串
 *   3. md5：sign = MD5(appSecret + 拼接串 + appSecret)，结果转大写
 *      hmac：sign = HMAC_MD5(appSecret, 拼接串)，结果转大写
 * 公共参数：method / app_key / session / timestamp(yyyy-MM-dd HH:mm:ss) / format / v / sign_method / sign
 */
export function taobaoTopSign(params: SignParams, appSecret: string, signMethod: 'md5' | 'hmac' = 'md5'): string {
  const concat = sortedEntries(params).map(([k, v]) => `${k}${v}`).join('');
  if (signMethod === 'hmac') {
    return crypto.createHmac('md5', appSecret).update(concat, 'utf8').digest('hex').toUpperCase();
  }
  return md5Hex(`${appSecret}${concat}${appSecret}`).toUpperCase();
}

// ────────────────── 抖店（抖音电商开放平台） ──────────────────

/**
 * 抖店签名。
 * 文档口径：
 *   1. 参与签名的参数固定为 app_key / method / param_json / timestamp / v（已是 ASCII 升序）
 *   2. paramPattern = "app_key" + app_key + "method" + method + "param_json" + param_json
 *                     + "timestamp" + timestamp + "v" + v
 *   3. signPattern  = app_secret + paramPattern + app_secret
 *   4. sign = MD5(signPattern)，小写十六进制
 * 注意：param_json 必须是「业务参数按 key 升序递归排序后」的紧凑 JSON 字符串，
 *       两端拼接前不可再做任何空白格式化，否则签名不匹配。
 */
export function doudianSign(
  params: { app_key: string; method: string; param_json: string; timestamp: string; v: string },
  appSecret: string
): string {
  const paramPattern =
    `app_key${params.app_key}` +
    `method${params.method}` +
    `param_json${params.param_json}` +
    `timestamp${params.timestamp}` +
    `v${params.v}`;
  return md5Hex(`${appSecret}${paramPattern}${appSecret}`);
}

/** 抖店要求 param_json 的 key 递归升序排列，此函数产出符合签名要求的紧凑 JSON */
export function stableJsonStringify(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableJsonStringify(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const body = Object.keys(obj)
      .sort()
      .filter((k) => obj[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableJsonStringify(obj[k])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

// ────────────────── 京东开放平台（宙斯） ──────────────────

/**
 * 京东签名。
 * 文档口径：sign = MD5(app_secret + key1value1key2value2... + app_secret)，结果转大写。
 * 公共参数：method / app_key / access_token / timestamp(yyyy-MM-dd HH:mm:ss) / format / v / 360buy_param_json
 */
export function jdSign(params: SignParams, appSecret: string): string {
  const concat = sortedEntries(params).map(([k, v]) => `${k}${v}`).join('');
  return md5Hex(`${appSecret}${concat}${appSecret}`).toUpperCase();
}

// ────────────────── 拼多多开放平台 ──────────────────

/**
 * 拼多多签名。
 * 文档口径：sign = MD5(client_secret + key1value1key2value2... + client_secret)，结果转大写。
 * 公共参数：type / client_id / access_token / timestamp(unix 秒) / data_type
 */
export function pddSign(params: SignParams, clientSecret: string): string {
  const concat = sortedEntries(params).map(([k, v]) => `${k}${v}`).join('');
  return md5Hex(`${clientSecret}${concat}${clientSecret}`).toUpperCase();
}

// ────────────────── 快手小店开放平台 ──────────────────

/**
 * 快手签名。
 * 文档口径：
 *   1. 除 sign 外参数按 key 升序，拼成 key=value&key=value
 *   2. MD5 方式：sign = MD5(拼接串 + "&signSecret=" + signSecret)，小写
 *      HMAC 方式：sign = HMAC_SHA256(signSecret, 拼接串)，小写十六进制
 * 公共参数：appkey / access_token / method(如 open.order.cursor.list) / signMethod
 *          / timestamp(毫秒) / version / param(业务 JSON)
 */
export function kuaishouSign(params: SignParams, signSecret: string, signMethod: 'MD5' | 'HMAC_SHA256' = 'MD5'): string {
  const concat = sortedEntries(params).map(([k, v]) => `${k}=${v}`).join('&');
  if (signMethod === 'HMAC_SHA256') {
    return crypto.createHmac('sha256', signSecret).update(concat, 'utf8').digest('hex');
  }
  return md5Hex(`${concat}&signSecret=${signSecret}`);
}

// ────────────────── Shopify ──────────────────

/**
 * Shopify Webhook 校验签名：base64(HMAC-SHA256(sharedSecret, rawBody))，
 * 与请求头 X-Shopify-Hmac-Sha256 做时序安全比较。
 */
export function shopifyWebhookHmac(rawBody: string, sharedSecret: string): string {
  return crypto.createHmac('sha256', sharedSecret).update(rawBody, 'utf8').digest('base64');
}

/** Shopify OAuth 回调 query 校验签名：hex(HMAC-SHA256(sharedSecret, 排序后的 query)) */
export function shopifyOAuthHmac(query: SignParams, sharedSecret: string): string {
  const concat = sortedEntries(query)
    .filter(([k]) => k !== 'hmac' && k !== 'signature')
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
  return crypto.createHmac('sha256', sharedSecret).update(concat, 'utf8').digest('hex');
}

/** 时序安全比较，防止签名校验被计时攻击 */
export function safeCompare(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

// ────────────────── Amazon SP-API（AWS Signature V4） ──────────────────

export interface SigV4Input {
  method: string;
  /** 形如 /orders/v0/orders */
  path: string;
  /** 查询参数（未编码） */
  query: SignParams;
  host: string;
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  payload?: string;
  /** 覆盖签名时间，便于单测；默认取当前时间 */
  date?: Date;
}

export interface SigV4Result {
  authorization: string;
  amzDate: string;
  headers: Record<string, string>;
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

function hmac(key: crypto.BinaryLike | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC3986 严格编码（AWS 要求 !'()* 也编码） */
function rfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * AWS Signature Version 4 签名。
 * Amazon SP-API 自 2023-10 起对多数接口只强制要求 x-amz-access-token（LWA），
 * 但 Restricted Data / 部分区域仍需要 SigV4，故此处按标准完整实现，随时可启用。
 *
 * 步骤（与 AWS 文档一致）：
 *   1. CanonicalRequest = METHOD\n CanonicalURI\n CanonicalQuery\n CanonicalHeaders\n SignedHeaders\n hash(payload)
 *   2. StringToSign = AWS4-HMAC-SHA256\n amzDate\n scope\n hash(CanonicalRequest)
 *   3. SigningKey = HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request")
 *   4. Signature = hex(HMAC(SigningKey, StringToSign))
 */
export function awsSigV4(input: SigV4Input): SigV4Result {
  const now = input.date || new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const payload = input.payload || '';
  const payloadHash = sha256Hex(payload);

  const canonicalQuery = sortedEntries(input.query)
    .map(([k, v]) => `${rfc3986(k)}=${rfc3986(v)}`)
    .join('&');

  const baseHeaders: Record<string, string> = {
    host: input.host,
    'x-amz-date': amzDate,
  };
  if (input.sessionToken) baseHeaders['x-amz-security-token'] = input.sessionToken;

  const headerKeys = Object.keys(baseHeaders).sort();
  const canonicalHeaders = headerKeys.map((k) => `${k}:${baseHeaders[k].trim()}\n`).join('');
  const signedHeaders = headerKeys.join(';');

  const canonicalRequest = [
    input.method.toUpperCase(),
    input.path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const kDate = hmac(`AWS4${input.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { authorization, amzDate, headers: { ...baseHeaders, Authorization: authorization } };
}

// ────────────────── 时间格式工具 ──────────────────

/** 淘宝 / 京东 / 抖店要求的 yyyy-MM-dd HH:mm:ss（东八区） */
export function formatCnTimestamp(date: Date = new Date()): string {
  const cn = new Date(date.getTime() + 8 * 3600 * 1000);
  return cn.toISOString().replace('T', ' ').slice(0, 19);
}

/** unix 秒 */
export function unixSeconds(date: Date = new Date()): string {
  return String(Math.floor(date.getTime() / 1000));
}

/** unix 毫秒 */
export function unixMillis(date: Date = new Date()): string {
  return String(date.getTime());
}

/** 构造查询串（用于 GET 请求） */
export function buildQuery(params: SignParams): string {
  return sortedEntries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
