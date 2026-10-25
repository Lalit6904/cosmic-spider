import type { NextFunction, Request, Response } from 'express';
import { authenticateRequest, assertCsrf } from '../services/sessions';

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  if (req.auth) {
    next();
    return;
  }
  try {
    const auth = await authenticateRequest(req);
    if (auth) req.auth = auth;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.auth) {
      const auth = await authenticateRequest(req);
      if (auth) req.auth = auth;
    }
    if (!req.auth) {
      res.status(401).json({
        error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.', requestId: req.requestId },
      });
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}

export function requireCsrf(req: Request, _res: Response, next: NextFunction): void {
  try {
    assertCsrf(req);
    next();
  } catch (error) {
    next(error);
  }
}
