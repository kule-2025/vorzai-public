import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';

// Request tracing middleware
export function requestTracer(req: Request, _res: Response, next: NextFunction): void {
  const rawTraceId = req.headers['x-trace-id'] as string;
  // SECURITY: Sanitize trace ID to prevent log injection
  req.traceId = rawTraceId
    ? rawTraceId.replace(/[^a-zA-Z0-9-]/g, '').slice(0, 64) || uuidv4()
    : uuidv4();
  next();
}

// Request logging middleware
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      traceId: req.traceId,
      userId: req.user?.userId,
    };

    if (res.statusCode >= 400) {
      logger.warn('http', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, logData);
    } else {
      logger.info('http', `${req.method} ${req.path} ${res.statusCode} ${duration}ms`, logData);
    }
  });

  next();
}

// Async handler wrapper - catches async errors and passes to error handler
export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// Standard success response
export function successResponse<T>(res: Response, data: T, message?: string, statusCode: number = 200): void {
  res.status(statusCode).json({
    success: true,
    data,
    message,
  });
}

/**
 * Standard error response. Mirrors `successResponse` so route handlers can bail
 * out early (e.g. on schema validation failure) without throwing.
 */
export function errorResponse(res: Response, statusCode: number, message: string, details?: unknown): void {
  res.status(statusCode).json({
    success: false,
    error: message,
    ...(details !== undefined ? { details } : {}),
  });
}

// Paginated response
export function notFound(entity: string, id: string): void {
  throw new Error(`${entity} 不存在: ${id}`);
}

export function paginatedResponse<T>(
  res: Response,
  data: T[],
  pagination: { page: number; limit: number; total: number; totalPages: number }
): void {
  res.json({
    success: true,
    data,
    pagination,
  });
}
