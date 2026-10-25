import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import path from 'node:path';
import pinoHttp from 'pino-http';
import { env } from './config/env';
import { createApiRouter } from './routes/api';
import { AppError, errorHandler, notFoundHandler } from './lib/errors';
import { logger } from './lib/logger';
import { pingDatabase } from './db/connect';
import type { GameHub } from './game/GameHub';
import {
  httpLimiters,
  originGuard,
  rejectDangerousInput,
  requestId,
} from './middleware/security';
import { optionalAuth } from './middleware/auth';

export interface ApplicationOptions {
  hub: GameHub;
}

export function createApp({ hub }: ApplicationOptions): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY ? 1 : false);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      autoLogging: {
        ignore: (req) => req.url === '/api/health' || req.url === '/api/health/ready',
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
    }),
  );

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'ws:', 'wss:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          ...(env.isProduction ? { upgradeInsecureRequests: [] } : {}),
        },
      },
      crossOriginEmbedderPolicy: false,
      hsts: env.isProduction ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    next();
  });
  app.use(compression());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || env.allowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(
          new AppError(400, 'ORIGIN_REJECTED', 'Request origin is not allowed.'),
        );
      },
      credentials: true,
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
      exposedHeaders: ['X-Request-Id', 'RateLimit', 'RateLimit-Policy'],
      maxAge: 600,
      optionsSuccessStatus: 204,
    }),
  );
  app.use(cookieParser());
  app.use('/api', express.json({ limit: '32kb', strict: true }));
  app.use('/api', originGuard, rejectDangerousInput);
  app.use('/api', optionalAuth);
  app.use('/api', httpLimiters.global);
  app.use('/api', (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });
  app.get('/api/health/ready', async (_req, res) => {
    const ready = await pingDatabase();
    res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'unavailable' });
  });

  app.use('/api', createApiRouter(hub));
  app.use('/api', notFoundHandler);

  const clientDirectory = path.resolve(process.cwd(), 'dist/client');
  const indexFile = path.join(clientDirectory, 'index.html');
  if (existsSync(indexFile)) {
    app.use(
      express.static(clientDirectory, {
        index: false,
        etag: true,
        maxAge: '1h',
        setHeaders: (res, filePath) => {
          if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (req, res, next) => {
      if (!req.accepts('html')) {
        next();
        return;
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(indexFile);
    });
  }

  app.use((_req, _res, next) => {
    next();
  });
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
