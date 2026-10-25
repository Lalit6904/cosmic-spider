import 'dotenv/config';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    HOST: z.string().min(1).default('127.0.0.1'),
    ALLOWED_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173,http://localhost:3001'),
    MONGODB_URI: z.string().min(1),
    MONGODB_TLS: booleanString.default(false),
    SESSION_COOKIE_NAME: z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,32}$/)
      .default('cs_session'),
    SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    TRUST_PROXY: booleanString.default(false),
    SECURE_COOKIES: booleanString.default(false),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).default(587),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
    SMTP_FROM: z.string().default('Cosmic Spider <no-reply@example.com>'),
    APP_PUBLIC_URL: z.string().url().default('http://localhost:5173'),
    MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).max(1000).default(12),
    MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100_000).default(1000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  })
  .superRefine((env, context) => {
    const origins = env.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
    if (origins.length === 0) {
      context.addIssue({ code: 'custom', message: 'ALLOWED_ORIGINS must contain at least one origin' });
    }
    for (const origin of origins) {
      try {
        const parsed = new URL(origin);
        if (parsed.origin !== origin.replace(/\/$/, '')) {
          context.addIssue({
            code: 'custom',
            message: `Allowed origin must be an exact origin without a path: ${origin}`,
          });
        }
        if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
          context.addIssue({ code: 'custom', message: `Production origins must use HTTPS: ${origin}` });
        }
      } catch {
        context.addIssue({ code: 'custom', message: `Invalid allowed origin: ${origin}` });
      }
    }
    if (env.NODE_ENV === 'production') {
      if (!env.SECURE_COOKIES) {
        context.addIssue({ code: 'custom', message: 'SECURE_COOKIES must be true in production' });
      }
      if (!env.SMTP_HOST) {
        context.addIssue({
          code: 'custom',
          message: 'SMTP_HOST is required in production so password recovery is deliverable',
        });
      }
      if (!env.APP_PUBLIC_URL.startsWith('https://')) {
        context.addIssue({ code: 'custom', message: 'APP_PUBLIC_URL must use HTTPS in production' });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema> & {
  allowedOrigins: string[];
  isProduction: boolean;
  isTest: boolean;
  sessionTtlMs: number;
};

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  const allowedOrigins = parsed.data.ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean);
  return {
    ...parsed.data,
    allowedOrigins,
    isProduction: parsed.data.NODE_ENV === 'production',
    isTest: parsed.data.NODE_ENV === 'test',
    sessionTtlMs: parsed.data.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

export const env = loadEnv();
