/**
 * 极简 SMTP 发送（无外部依赖，仅用 Node 内置 net/tls）
 * 支持：隐式 TLS（端口 465） + AUTH PLAIN。
 * 覆盖主流邮箱（Gmail / Outlook / 腾讯企业邮等 465 端口）的常见场景。
 * STARTTLS（587）升级暂未实现，会返回明确提示，避免假装成功。
 */
import net from 'net';
import tls from 'tls';
import { logger } from '../utils/logger';

export interface SmtpSendInput {
  host: string;
  port: number;
  secure?: boolean; // 隐式 TLS（465）
  user: string;
  pass: string;
  from: string;
  to: string;
  subject: string;
  body: string;
}

export interface SmtpResult {
  ok: boolean;
  messageId: string;
  message: string;
}

function toBase64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

export async function sendSmtpMail(input: SmtpSendInput): Promise<SmtpResult> {
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@vorzai.local>`;
  const useTls = input.secure || input.port === 465;

  if (!useTls) {
    return { ok: false, messageId, message: '仅支持隐式 TLS（端口 465）。STARTTLS(587) 暂未支持，请改用 465 端口。' };
  }

  const socket = tls.connect({ host: input.host, port: input.port, rejectUnauthorized: false });

  const read = (): Promise<string> =>
    new Promise((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        const text = chunk.toString();
        const lines = text.split(/\r\n|\n/).filter((l) => l.length > 0);
        const last = lines[lines.length - 1];
        if (last && /^\d{3}[ -]/.test(last)) {
          socket.off('data', onData);
          resolve(last);
        }
      };
      socket.on('data', onData);
      socket.on('error', (e) => {
        socket.off('data', onData);
        reject(e);
      });
    });

  const send = (cmd: string): Promise<string> => {
    socket.write(cmd + '\r\n');
    return read();
  };

  const expect = (code: string) => (line: string) => {
    if (!line.startsWith(code)) {
      throw new Error(`SMTP 期望 ${code}，收到: ${line}`);
    }
    return line;
  };

  try {
    await Promise.race([
      read(), // 220 greeting
      new Promise((_, rej) => setTimeout(() => rej(new Error('SMTP 握手超时')), 15000)),
    ]);
    await send('EHLO vorzai.local').then(expect('250'));
    await send(`AUTH PLAIN ${toBase64(`\u0000${input.user}\u0000${input.pass}`)}`).then(expect('235'));
    await send(`MAIL FROM:<${input.from}>`).then(expect('250'));
    await send(`RCPT TO:<${input.to}>`).then(expect('250'));
    await send('DATA').then(expect('354'));

    const dateStr = new Date().toUTCString();
    const dataLines = [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: =?utf-8?B?${toBase64(input.subject)}?=`,
      `Date: ${dateStr}`,
      `Message-ID: ${messageId}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      input.body.replace(/\r\n|\r/g, '\n').replace(/^\./gm, '..'),
      '.',
    ].join('\r\n');
    await send(dataLines).then(expect('250'));
    await send('QUIT').catch(() => {});
    return { ok: true, messageId, message: `已发送至 ${input.to}` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.warn('email', `SMTP send failed: ${msg}`);
    return { ok: false, messageId, message: `发送失败: ${msg}` };
  } finally {
    try { socket.destroy(); } catch { /* noop */ }
  }
}
