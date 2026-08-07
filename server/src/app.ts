import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requestTracer, requestLogger } from './middleware/common';
import { logger } from './utils/logger';
import { sanitizeString, sanitizeRequestBody } from './utils/security';
import { getDatabase } from './db';

// 进程级请求计数器（用于 /api/health 可观测性，非精确计数）
let requestCount = 0;

// Route imports
import authRoutes from './routes/auth';
import ogsmRoutes from './routes/ogsm';
import hrRoutes from './routes/hr';
import businessRoutes from './routes/business';
import knowledgeRoutes from './routes/knowledge';
import chatRoutes from './routes/chat';
import dialogRoutes from './routes/dialog';
import licenseRoutes from './routes/license';
import emailRoutes from './routes/email';
import cockpitRoutes from './routes/cockpit';
import incentiveRoutes from './routes/incentive';
import crossborderRoutes from './routes/crossborder';
import livestreamRoutes from './routes/livestream';
import platformRoutes from './routes/platform';
import analyticsRoutes from './routes/analytics';
import inventoryRoutes from './routes/inventory';
import procurementRoutes from './routes/procurement';
import monitorRoutes from './routes/monitor';
import workflowRoutes from './routes/workflow';
import ogsmTrackingRoutes from './routes/ogsmTracking';
import tenantRoutes from './routes/tenant';
import leaveRoutes from './routes/leave';
import agentRoutes from './routes/agent';
import llmRoutes from './routes/llm';
import healthRoutes from './routes/health';

export function createApp(): express.Application {
  const app = express();

  // Security middleware
  app.use(helmet({
    // 启用 CSP 作为纵深防御（即使 React 默认转义 JSX，仍防存储型 XSS 触发）
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'http://127.0.0.1:19527', 'http://localhost:3000'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: false, // 本地 HTTP 服务无需 HSTS
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  }));

  // CORS - allow local Electron renderer
  app.use(cors({
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'app://electron'],
    credentials: true,
  }));

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 纵深防御：对所有 JSON 请求体中的字符串字段做净化，防止存储型 XSS / 日志注入。
  // 跳过密码类字段（保留原始强度字符）与原始文本字段（csv / content / attributes）。
  const BODY_SKIP_FIELDS = new Set([
    'password', 'newPassword', 'oldPassword', 'confirmPassword',
    'csv', 'content', 'attributes', 'rawData', 'signature', 'token',
  ]);
  app.use((req: any, _res: any, next: any) => {
    if (req.body && typeof req.body === 'object') {
      sanitizeRequestBody(req.body, BODY_SKIP_FIELDS);
    }
    next();
  });

  // Compression
  app.use(compression());

  // Rate limiting — 严格分层限流
  // 认证端点：10次/15分钟（防暴力破解）
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: '认证请求过于频繁，请稍后再试' } },
  });

  // 通用API：1000次/15分钟
  const apiLimiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: { code: 'RATE_LIMIT_EXCEEDED', message: '请求过于频繁' } },
  });

  // Request tracing and logging
  app.use(requestTracer);
  app.use(requestLogger);

  // 请求计数中间件（置于健康检查之前，统计全部后续 API 请求）
  app.use((_req, _res, next) => {
    requestCount++;
    next();
  });

  // Health check（真实可观测性：DB 连通探针 + 内存 + 请求计数）
  app.get('/api/health', (_req, res) => {
    const mem = process.memoryUsage();
    let dbConnected = false;
    let dbLatency = -1;
    try {
      const db = getDatabase();
      const t0 = Date.now();
      db.prepare('SELECT 1').get();
      dbLatency = Date.now() - t0;
      dbConnected = true;
    } catch {
      dbConnected = false;
    }
    const status = dbConnected ? 'healthy' : 'degraded';
    res.json({
      success: true,
      data: {
        status,
        version: '0.2.4',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        requests: requestCount,
        memory: {
          rssMb: Math.round(mem.rss / 1024 / 1024),
          heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
          heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        },
        database: { connected: dbConnected, latencyMs: dbLatency },
      },
    });
  });

  // Auth routes — strict rate limit
  app.use('/api/auth/login', authLimiter);
  app.use('/api/auth/register', authLimiter);
  app.use('/api/auth', authRoutes);

  // License routes (with account status check already in router)
  app.use('/api/license', licenseRoutes);

  // Business API routes — standard rate limit + license check via router middleware
  app.use('/api/', apiLimiter);
  app.use('/api/ogsm', ogsmRoutes);
  app.use('/api/hr', hrRoutes);
  app.use('/api/business', businessRoutes);
  app.use('/api', knowledgeRoutes);
  app.use('/api/chat', chatRoutes);
  app.use('/api/dialog', dialogRoutes);
  app.use('/api/connectors/email', emailRoutes);
  app.use('/api/cockpit', cockpitRoutes);
  app.use('/api/crossborder', crossborderRoutes);
  app.use('/api/livestream', livestreamRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/analytics', analyticsRoutes);
  app.use('/api/inventory', inventoryRoutes);
  app.use('/api/procurement', procurementRoutes);
  app.use('/api/monitor', monitorRoutes);
  app.use('/api/workflows', workflowRoutes);
app.use('/api/leave', leaveRoutes);
app.use('/api/incentives', incentiveRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/llm', llmRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/ogsm-tracking', ogsmTrackingRoutes);
  app.use('/api/tenant', tenantRoutes);

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
}
