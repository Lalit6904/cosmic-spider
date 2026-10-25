import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import { env } from '../config/env';
import { logger, securityLog } from './logger';

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly expose: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { fields?: Record<string, string>; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.fields = options.fields;
    this.expose = options.expose ?? status < 500;
  }
}

export function badRequest(code: string, message: string, fields?: Record<string, string>): AppError {
  return new AppError(400, code, message, { fields });
}

export function unauthorized(message = 'Authentication required.'): AppError {
  return new AppError(401, 'UNAUTHENTICATED', message);
}

export function forbidden(message = 'You do not have permission to do that.'): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Resource not found.'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message);
}

export function tooManyRequests(message = 'Too many requests. Please wait and try again.', retryAfterMs?: number): AppError {
  const error = new AppError(429, 'RATE_LIMITED', message);
  if (retryAfterMs != null) {
    Object.assign(error, { retryAfterMs });
  }
  return error;
}

export function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

export function zodFields(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || 'form';
    if (!fields[path]) fields[path] = issue.message;
  }
  return fields;
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.requestId;
  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Please check the highlighted fields.',
        fields: zodFields(error),
        requestId,
      },
    });
    return;
  }

  if (error instanceof AppError) {
    if (error.status >= 500) {
      logger.error({ err: error, requestId }, 'Application error');
    } else if (error.status === 403 || error.status === 401) {
      securityLog.info(
        { requestId, code: error.code, path: req.path, method: req.method, ip: req.ip },
        'Request rejected',
      );
    }
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.expose ? error.message : 'Something went wrong.',
        ...(error.fields ? { fields: error.fields } : {}),
        requestId,
      },
    });
    return;
  }

  // Mongoose duplicate-key errors are intentionally not reflected to clients.
  if (typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 11000) {
    res.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'That value is already in use.',
        requestId,
      },
    });
    return;
  }

  logger.error({ err: error, requestId, path: req.path, method: req.method }, 'Unhandled application error');
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
      requestId,
    },
  });
}

export function notFoundHandler(req: Request, res: Response): void {
  const isApi = req.originalUrl.startsWith('/api/') || req.path.startsWith('/api/');
  if (isApi) {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.', requestId: req.requestId } });
    return;
  }
  // In production, the SPA fallback is registered before this handler.
  res.status(404).type('text/plain').send(env.isProduction ? 'Not found' : 'Not found. Build the client or use the Vite dev server.');
}
