import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { logger } from '../utils/logger';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  traceId?: string;
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = '服务器内部错误';
  let details: Record<string, unknown> | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if ((err as any).name === 'ZodError' || (err as any).issues) {
    const zodErr = err as any;
    statusCode = 400;
    code = 'VALIDATION_ERROR';
    message = '请求参数验证失败';
    details = {
      fields: (zodErr.errors || zodErr.issues || []).map((e: any) => ({
        path: e.path ? e.path.join('.') : e.code,
        message: e.message,
      })),
    };
  } else if (err instanceof SyntaxError && 'body' in err) {
    statusCode = 400;
    code = 'INVALID_JSON';
    message = '请求体JSON格式无效';
  }

  // Log errors
  if (statusCode >= 500) {
    logger.error('http', `${req.method} ${req.path} - ${message}`, {
      stack: err.stack,
      body: req.body,
      traceId: req.traceId,
    });
  } else {
    logger.warn('http', `${req.method} ${req.path} - ${statusCode} ${code}`, {
      message,
      traceId: req.traceId,
    });
  }

  const response: ErrorResponse = {
    success: false,
    error: { code, message, details },
    traceId: req.traceId,
  };

  res.status(statusCode).json(response);
}

// 404 handler
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `接口 ${req.method} ${req.path} 不存在`,
    },
  });
}
