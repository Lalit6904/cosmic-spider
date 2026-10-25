import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { MemoryStore, rateLimit } from 'express-rate-limit';
import { env } from '../config/env';
import { badRequest } from '../lib/errors';
import { securityLog } from '../lib/logger';

export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

export function originGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get('origin');
  if (!origin) {
    if (env.isProduction) {
      next(badRequest('ORIGIN_REQUIRED', 'A valid Origin header is required.'));
      return;
    }
    next();
    return;
  }
  if (!env.allowedOrigins.includes(origin)) {
    securityLog.warn({ origin, ip: req.ip, path: req.path }, 'Rejected HTTP origin');
    next(badRequest('ORIGIN_REJECTED', 'Request origin is not allowed.'));
    return;
  }
  next();
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function hasDangerousKey(value: unknown, depth = 0): boolean {
  if (depth > 20 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasDangerousKey(entry, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key) || key.startsWith('$') || key.includes('.')) return true;
    if (hasDangerousKey(child, depth + 1)) return true;
  }
  return false;
}

export function rejectDangerousInput(req: Request, _res: Response, next: NextFunction): void {
  if (hasDangerousKey(req.body) || hasDangerousKey(req.query)) {
    securityLog.warn({ ip: req.ip, path: req.path }, 'Rejected dangerous object keys');
    next(badRequest('INVALID_INPUT', 'Request contains a disallowed field.'));
    return;
  }
  next();
}

export function requireJson(req: Request, _res: Response, next: NextFunction): void {
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && !req.is('application/json')) {
    next(badRequest('JSON_REQUIRED', 'Content-Type must be application/json.'));
    return;
  }
  next();
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

const stores: MemoryStore[] = [];

export function resetHttpRateLimits(): void {
  for (const store of stores) store.resetAll();
}

function makeLimiter(name: string, windowMs: number, limit: number, message: string) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    store,
    handler: (req, res) => {
      securityLog.warn({ ip: req.ip, limit: name, path: req.path }, 'HTTP rate limit exceeded');
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message,
          requestId: req.requestId,
        },
      });
    },
  });
}

/**
 * In-memory stores are appropriate for the documented single-instance
 * deployment. Use a shared Redis store before horizontally scaling.
 */
export const httpLimiters = {
  global: makeLimiter('global', 15 * 60_000, 600, 'Too many requests. Please wait and try again.'),
  login: makeLimiter('login', 15 * 60_000, 15, 'Too many sign-in attempts. Try again later.'),
  register: makeLimiter('register', 60 * 60_000, 8, 'Too many account creations from this network.'),
  forgot: makeLimiter('forgot', 15 * 60_000, 5, 'Too many recovery requests. Try again later.'),
  reset: makeLimiter('reset', 15 * 60_000, 8, 'Too many reset attempts. Try again later.'),
  passwordChange: makeLimiter('password-change', 60 * 60_000, 10, 'Too many password changes.'),
  profile: makeLimiter('profile', 15 * 60_000, 120, 'Too many profile requests.'),
  leaderboard: makeLimiter('leaderboard', 15 * 60_000, 120, 'Too many leaderboard requests.'),
};
