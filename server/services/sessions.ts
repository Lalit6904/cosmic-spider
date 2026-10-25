import type { Request, Response } from 'express';
import type { AuthUser } from '../../shared/protocol';
import { env } from '../config/env';
import { hashToken, randomToken, constantTimeEqualHex } from '../lib/crypto';
import { unauthorized } from '../lib/errors';
import { Session, type SessionDocument } from '../models/Session';
import { User } from '../models/User';

export const CSRF_COOKIE_NAME = 'cs_csrf';

export interface SessionMaterial {
  token: string;
  csrfToken: string;
  session: SessionDocument;
}

function cookieBase() {
  return {
    httpOnly: true,
    secure: env.SECURE_COOKIES,
    sameSite: 'lax' as const,
    path: '/',
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    ...cookieBase(),
    maxAge: env.sessionTtlMs,
  });
}

export function setCsrfCookie(res: Response, token: string): void {
  // Readable by same-origin JavaScript by design. It is not an auth credential;
  // it is half of the synchronizer token pair and is bound to the session hash.
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...cookieBase(),
    httpOnly: false,
    maxAge: env.sessionTtlMs,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieBase());
  res.clearCookie(CSRF_COOKIE_NAME, { ...cookieBase(), httpOnly: false });
}

export async function createSession(userId: string, userAgent = ''): Promise<SessionMaterial> {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const session = await Session.create({
    userId,
    tokenHash: hashToken(token),
    csrfHash: hashToken(csrfToken),
    expiresAt: new Date(Date.now() + env.sessionTtlMs),
    userAgent: userAgent.slice(0, 300),
  });
  return { token, csrfToken, session };
}

export function issueSession(res: Response, material: SessionMaterial): void {
  setSessionCookie(res, material.token);
  setCsrfCookie(res, material.csrfToken);
}

export function toAuthUser(user: {
  _id: { toString(): string };
  username: string;
  email?: string;
  stats?: { gamesPlayed: number; wins: number; correctGuesses: number; totalPoints: number };
  createdAt?: Date;
}): AuthUser {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email ?? '',
    stats: {
      gamesPlayed: user.stats?.gamesPlayed ?? 0,
      wins: user.stats?.wins ?? 0,
      correctGuesses: user.stats?.correctGuesses ?? 0,
      totalPoints: user.stats?.totalPoints ?? 0,
    },
    createdAt: (user.createdAt ?? new Date(0)).toISOString(),
  };
}

export async function authenticateRequest(req: Request): Promise<Express.Request['auth'] | null> {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token !== 'string' || token.length < 20) return null;
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: new Date() },
  });
  if (!session) return null;

  const user = await User.findById(session.userId).select('+email');
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return { session, user: toAuthUser(user) };
}

export function requireAuth(req: Request): NonNullable<Express.Request['auth']> {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function assertCsrf(req: Request): void {
  const auth = requireAuth(req);
  const header = req.get('x-csrf-token');
  if (typeof header !== 'string' || header.length < 20 || header.length > 200) {
    throw unauthorized('Your security token is missing. Refresh the page and try again.');
  }
  const headerHash = hashToken(header);
  if (!constantTimeEqualHex(headerHash, auth.session.csrfHash)) {
    throw unauthorized('Your security token is invalid. Refresh the page and try again.');
  }
}

export function csrfTokenForRequest(req: Request): string | null {
  const auth = req.auth;
  if (!auth) return null;
  const token = req.cookies?.[CSRF_COOKIE_NAME];
  if (typeof token !== 'string' || token.length < 20) return null;
  return constantTimeEqualHex(hashToken(token), auth.session.csrfHash) ? token : null;
}

/**
 * Restores the readable CSRF half after a reload. If the cookie is missing or
 * has been tampered with, rotate the CSRF binding for this authenticated session.
 */
export async function ensureCsrfToken(req: Request, res: Response): Promise<string | null> {
  const auth = req.auth;
  if (!auth) return null;
  const existing = csrfTokenForRequest(req);
  if (existing) return existing;
  const csrfToken = randomToken(32);
  await Session.updateOne({ _id: auth.session._id }, { $set: { csrfHash: hashToken(csrfToken) } });
  setCsrfCookie(res, csrfToken);
  return csrfToken;
}

export async function rotateSession(
  req: Request,
  res: Response,
  userId: string,
): Promise<SessionMaterial> {
  const oldToken = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof oldToken === 'string') {
    await Session.deleteOne({ tokenHash: hashToken(oldToken) });
  }
  const material = await createSession(userId, req.get('user-agent') ?? '');
  issueSession(res, material);
  return material;
}

export async function revokeCurrentSession(req: Request): Promise<void> {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token === 'string') {
    await Session.deleteOne({ tokenHash: hashToken(token) });
  }
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await Session.deleteMany({ userId });
}
