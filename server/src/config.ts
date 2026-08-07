import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// Electron app may not be available in standalone/dev mode
let userDataPath: string;
try {
  const { app } = require('electron');
  userDataPath = app.getPath('userData');
} catch {
  userDataPath = path.join(process.cwd(), 'data');
}

const isDev = process.env.NODE_ENV === 'development' || !process.env.ELECTRON_RUN_AS_NODE;

/**
 * SECURITY: Generate a cryptographically random JWT secret on first run
 * and persist it to a local file. Never use a hardcoded fallback.
 */
function getOrCreateJwtSecret(): string {
  if (process.env.VORZAI_JWT_SECRET) {
    return process.env.VORZAI_JWT_SECRET;
  }

  const secretDir = isDev ? path.join(process.cwd(), 'data') : userDataPath;
  const secretPath = path.join(secretDir, '.jwt_secret');

  try {
    if (fs.existsSync(secretPath)) {
      return fs.readFileSync(secretPath, 'utf-8').trim();
    }
  } catch { /* fall through to generate */ }

  // Generate new random secret (256-bit)
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    if (!fs.existsSync(secretDir)) {
      fs.mkdirSync(secretDir, { recursive: true });
    }
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch {
    // If we can't persist, use in-memory only (will regenerate on restart)
  }
  return secret;
}

export const config = {
  server: {
    port: parseInt(process.env.VORZAI_API_PORT || '19527', 10),
    host: '127.0.0.1',
  },
  db: {
    path: isDev
      ? path.join(process.cwd(), 'data', 'vorzai.db')
      : path.join(userDataPath, 'vorzai.db'),
  },
  jwt: {
    secret: getOrCreateJwtSecret(),
    accessTokenExpiry: '2h',
    refreshTokenExpiry: '30d',
  },
  bcrypt: {
    saltRounds: 10,
  },
  rateLimit: {
    windowMs: 15 * 60 * 1000,
    max: 1000,
  },
  pagination: {
    defaultPage: 1,
    defaultLimit: 20,
    maxLimit: 100,
  },
  llm: {
    defaultProvider: process.env.VORZAI_LLM_PROVIDER || 'openai',
    apiKey: process.env.VORZAI_LLM_API_KEY || '',
    baseUrl: process.env.VORZAI_LLM_BASE_URL || 'https://api.openai.com/v1',
    model: process.env.VORZAI_LLM_MODEL || 'gpt-4o-mini',
  },
} as const;

export type AppConfig = typeof config;
