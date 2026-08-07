import fs from 'fs';
import path from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LogEntry {
  timestamp: string;
  level: string;
  module: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
}

// ── PII 脱敏 ───────────────────────────────────────────────
// 日志落地前递归擦除敏感字段与可识别个人信息，避免凭据/隐私泄露到日志文件
const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|token|secret|api[_-]?key|authorization|cookie|private[_-]?key|credential|sessionid|otp)$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /\b1[3-9]\d{9}\b/g;
const ID_CARD_RE = /\b\d{17}[\dXx]\b/g;

function maskEmail(email: string): string {
  return email.replace(/^(.?).*?(@)(.+)$/, (_m, first: string, at: string, domain: string) => `${first}***${at}${domain}`);
}

export function scrubPII<T>(value: T): T {
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string') {
      let s = value.replace(EMAIL_RE, maskEmail);
      s = s.replace(PHONE_RE, (m) => `${m.slice(0, 3)}****${m.slice(7)}`);
      s = s.replace(ID_CARD_RE, (m) => `${m.slice(0, 6)}********${m.slice(14)}`);
      return s as unknown as T;
    }
    return value;
  }
  if (value instanceof Error) {
    return { name: value.name, message: scrubPII(value.message), stack: scrubPII(value.stack) } as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => scrubPII(v)) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY_RE.test(k) ? '[REDACTED]' : scrubPII(v);
  }
  return out as unknown as T;
}

class Logger {
  private level: LogLevel;
  private logDir: string;
  private logFile: string;

  constructor(module: string = 'app') {
    this.level = process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.INFO;
    this.logDir = path.join(process.cwd(), 'logs');
    this.logFile = path.join(this.logDir, `vorzai-${new Date().toISOString().slice(0, 10)}.log`);
    this.ensureLogDir();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      // Fallback: log to console only
    }
  }

  private write(entry: LogEntry): void {
    const line = JSON.stringify(entry);

    if (this.level >= LogLevel[entry.level as keyof typeof LogLevel]) {
      const prefix = `[${entry.timestamp}] [${entry.level}] [${entry.module}]`;
      if (entry.level === 'ERROR') {
        console.error(prefix, entry.message, entry.data || '');
      } else if (entry.level === 'WARN') {
        console.warn(prefix, entry.message, entry.data || '');
      } else {
        console.log(prefix, entry.message, entry.data || '');
      }
    }

    try {
      fs.appendFileSync(this.logFile, line + '\n');
    } catch {
      // Silent fail for file writes
    }
  }

  private createEntry(level: string, module: string, message: string, data?: Record<string, unknown>): LogEntry {
    const safeData = data ? scrubPII(data) : undefined;
    return {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      data: safeData,
      traceId: (safeData as Record<string, unknown> | undefined)?.traceId as string | undefined,
    };
  }

  error(module: string, message: string, data?: Record<string, unknown>): void {
    this.write(this.createEntry('ERROR', module, message, data));
  }

  warn(module: string, message: string, data?: Record<string, unknown>): void {
    this.write(this.createEntry('WARN', module, message, data));
  }

  info(module: string, message: string, data?: Record<string, unknown>): void {
    this.write(this.createEntry('INFO', module, message, data));
  }

  debug(module: string, message: string, data?: Record<string, unknown>): void {
    this.write(this.createEntry('DEBUG', module, message, data));
  }
}

export const logger = new Logger();
