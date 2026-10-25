import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logs deliberately redact credentials and session material.
 * Game secrets are never passed to the logger at all.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'cosmic-spider', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      'password',
      'currentPassword',
      'newPassword',
      'token',
      'csrfToken',
      'secret',
      'word',
      '*.password',
      '*.token',
      '*.csrfToken',
    ],
    censor: '[REDACTED]',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const securityLog = logger.child({ channel: 'security' });
export const gameLog = logger.child({ channel: 'game' });
