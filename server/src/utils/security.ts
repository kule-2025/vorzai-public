/**
 * 集中式安全工具模块
 *
 * 提供：
 * 1. 密码强度策略校验（防弱口令）
 * 2. 用户输入字符串净化（防存储型 XSS / 日志注入）
 * 3. 文件名净化（防路径遍历）
 * 4. 通用安全常量
 *
 * 设计原则：纵深防御。前端 React 默认转义 JSX 输出，此处作为后端第二道防线，
 * 确保所有落库的用户文本都不含可执行脚本片段，且不破坏正常业务字符（如中文、emoji）。
 */

// ── 密码策略 ──

export interface PasswordCheckResult {
  valid: boolean;
  errors: string[];
}

/**
 * 密码强度校验：
 * - 长度 8~128
 * - 至少包含大写、小写、数字中的两类
 * - 不允许常见弱口令
 * - 不允许纯空白或常见模式（如 12345678、aaaaaaaa）
 */
const COMMON_WEAK_PASSWORDS = new Set([
  'password', 'password123', '12345678', '123456789', 'qwerty123',
  'admin123', 'letmein', 'welcome1', 'abc12345', 'iloveyou',
  '11111111', '00000000', 'passw0rd', 'qwertyui', '1q2w3e4r',
  'zhang123', 'wang123', 'li123456', 'admin888', 'root12345',
]);

export function validatePasswordStrength(password: string): PasswordCheckResult {
  const errors: string[] = [];

  if (typeof password !== 'string') {
    return { valid: false, errors: ['密码格式无效'] };
  }

  if (password.length < 8) {
    errors.push('密码长度至少为 8 位');
  }
  if (password.length > 128) {
    errors.push('密码长度不能超过 128 位');
  }

  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  const categoryCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  if (categoryCount < 2) {
    errors.push('密码至少需包含大写字母、小写字母、数字或特殊符号中的两类');
  }

  // 拒绝连续或重复字符过多
  if (/^(.)\1{5,}$/.test(password)) {
    errors.push('密码不能由重复字符组成');
  }
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef)/i.test(password)) {
    errors.push('密码不能包含连续的简单序列');
  }

  const lowerPwd = password.toLowerCase();
  if (COMMON_WEAK_PASSWORDS.has(lowerPwd)) {
    errors.push('该密码过于常见，请更换');
  }

  return { valid: errors.length === 0, errors };
}

// ── 输入净化 ──

/**
 * 净化用户文本输入，防止存储型 XSS 与日志注入。
 * 仅移除/转义可执行的脚本构造，保留正常业务字符（中文、字母、数字、标点、emoji、换行）。
 */
export function sanitizeString(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input !== 'string') {
    // 非字符串尝试转为字符串（如数字、布尔）
    try {
      input = String(input);
    } catch {
      return '';
    }
  }

  let s = input as string;

  // 1. 移除 HTML 标签（防御 <script>、<img onerror> 等）
  //    先移除成对标签及其内容（如 <script>...</script>），再移除剩余孤立标签
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<[^>]*>/g, '');

  // 2. 移除危险的协议前缀（防御 javascript:、data:text/html）
  s = s.replace(/javascript:/gi, '');
  s = s.replace(/data:text\/html/gi, '');
  s = s.replace(/vbscript:/gi, '');

  // 3. 转义日志注入常用的控制字符（\n \r 在日志中可能被利用伪造日志行）
  //    但保留业务数据中的正常换行 -> 仅移除 \r 防止日志注入，保留 \n 为空格等价
  s = s.replace(/\r/g, '');

  // 4. 截断超长输入（防止滥用存储）
  if (s.length > 10000) {
    s = s.slice(0, 10000);
  }

  return s.trim();
}

/**
 * 净化对象中的字符串字段（递归处理一层嵌套）。
 * 用于 API 入参落库前的统一净化。
 */
export function sanitizeObject<T extends Record<string, unknown>>(obj: T): T {
  const result = { ...obj } as Record<string, unknown>;
  for (const key of Object.keys(result)) {
    const value = result[key];
    if (typeof value === 'string') {
      result[key] = sanitizeString(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeString(item) : item
      );
    }
  }
  return result as T;
}

/**
 * 文件名净化：移除路径分隔符与父目录引用，防止路径遍历攻击。
 */
export function sanitizeFilename(filename: string): string {
  if (typeof filename !== 'string') return 'unnamed';
  return filename
    .replace(/[\/\\]/g, '_')
    .replace(/\.\./g, '_')
    .replace(/[\x00-\x1f<>:"|?*]/g, '_')
    .slice(0, 200)
    .trim() || 'unnamed';
}

/**
 * 校验上传内容类型是否为允许的格式（防恶意文件上传）。
 */
export function isAllowedUploadType(mimeType: string, allowed: string[]): boolean {
  return allowed.includes(mimeType.toLowerCase());
}

// 允许的文件 MIME 类型（CSV / JSON 导入场景）
export const ALLOWED_IMPORT_MIME_TYPES = [
  'text/csv',
  'application/csv',
  'text/plain',
  'application/json',
  'application/octet-stream', // 某些浏览器对 CSV 返回此类型
];

/**
 * 递归净化请求体中的字符串字段。
 * @param body 请求体对象（会被原地修改）
 * @param skipFields 跳过净化的字段名集合（如密码、原始文本）
 */
export function sanitizeRequestBody(body: Record<string, unknown>, skipFields: Set<string>): void {
  if (!body || typeof body !== 'object') return;

  for (const key of Object.keys(body)) {
    if (skipFields.has(key)) continue;

    const value = body[key];
    if (typeof value === 'string') {
      body[key] = sanitizeString(value);
    } else if (Array.isArray(value)) {
      body[key] = value.map((item) =>
        typeof item === 'string' ? sanitizeString(item) : item
      );
    } else if (value && typeof value === 'object') {
      sanitizeRequestBody(value as Record<string, unknown>, skipFields);
    }
  }
}
