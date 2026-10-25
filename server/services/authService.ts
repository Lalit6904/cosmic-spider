import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import type { AuthUser, LeaderboardEntry, ProfileGame } from '../../shared/protocol';
import { rankPlayers } from '../../shared/game';
import { AppError, badRequest, conflict } from '../lib/errors';
import { randomToken, hashToken } from '../lib/crypto';
import { hashPassword, verifyPassword, verifyPasswordOrDummy, burnPasswordTime } from '../lib/password';
import { securityLog } from '../lib/logger';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { GameSession } from '../models/GameSession';
import { env } from '../config/env';
import type { LoginInput, RegisterInput } from '../validation/schemas';
import {
  clearAuthCookies,
  createSession,
  issueSession,
  revokeAllSessions,
  revokeCurrentSession,
  rotateSession,
  toAuthUser,
} from './sessions';
import { sendPasswordResetEmail } from './mail';

const INVALID_CREDENTIALS = 'Invalid email or password.';
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MS = 15 * 60_000;

export interface AuthResult {
  user: AuthUser;
  csrfToken: string;
}

export async function registerUser(
  input: RegisterInput,
  req: Request,
  res: Response,
): Promise<AuthResult> {
  const usernameLower = input.username.toLowerCase();
  const emailLower = input.email.toLowerCase();
  const existing = await User.exists({
    $or: [{ usernameLower }, { emailLower }],
  });
  if (existing) {
    throw conflict('ACCOUNT_EXISTS', 'That username or email is already registered.');
  }

  const passwordHash = await hashPassword(input.password);
  const user = await User.create({
    username: input.username,
    usernameLower,
    email: emailLower,
    emailLower,
    passwordHash,
  });
  const material = await createSession(user._id.toString(), req.get('user-agent') ?? '');
  issueSession(res, material);
  securityLog.info({ userId: user._id.toString() }, 'Account registered');
  return { user: toAuthUser({ ...user.toObject(), email: emailLower }), csrfToken: material.csrfToken };
}

export async function loginUser(input: LoginInput, req: Request, res: Response): Promise<AuthResult> {
  const emailLower = input.email.toLowerCase();
  const user = await User.findOne({ emailLower }).select(
    '+passwordHash +failedLoginAttempts +lockUntil +email',
  );
  const now = Date.now();
  const locked = Boolean(user?.lockUntil && user.lockUntil.getTime() > now);

  if (!user) {
    await burnPasswordTime(input.password);
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
  }

  const valid = await verifyPasswordOrDummy(input.password, user.passwordHash);
  if (locked) {
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
  }
  if (!valid) {
    const updated = await User.findOneAndUpdate(
      { _id: user._id },
      { $inc: { failedLoginAttempts: 1 } },
      { returnDocument: 'after', projection: { failedLoginAttempts: 1 } },
    );
    if ((updated?.failedLoginAttempts ?? 0) >= MAX_FAILED_ATTEMPTS) {
      await User.updateOne({ _id: user._id }, { $set: { lockUntil: new Date(now + LOCK_MS) } });
    }
    securityLog.warn({ userId: user._id.toString() }, 'Failed sign-in');
    throw new AppError(401, 'INVALID_CREDENTIALS', INVALID_CREDENTIALS);
  }

  if (user.lockUntil || (user.failedLoginAttempts ?? 0) > 0) {
    await User.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 0, lockUntil: null } });
  }
  const material = await rotateSession(req, res, user._id.toString());

  return {
    user: toAuthUser({ ...user.toObject(), email: user.email }),
    csrfToken: material.csrfToken,
  };
}

export async function forgotPassword(email: string): Promise<void> {
  const emailLower = email.toLowerCase();
  const user = await User.findOne({ emailLower });
  if (!user) {
    // Keep the response shape and a comparable amount of work for unknown emails.
    await new Promise((resolve) => setTimeout(resolve, 30));
    return;
  }

  await PasswordResetToken.deleteMany({ userId: user._id });
  const token = randomToken(32);
  await PasswordResetToken.create({
    userId: user._id,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  });

  const resetUrl = `${env.APP_PUBLIC_URL.replace(/\/$/, '')}/reset/${encodeURIComponent(token)}`;
  // Delivery timing must not reveal whether an account exists. Delivery errors
  // are recorded without credential material.
  void sendPasswordResetEmail(emailLower, resetUrl).catch(() => {
    securityLog.error({ userId: user._id.toString() }, 'Password reset email delivery failed');
  });
  securityLog.info({ userId: user._id.toString() }, 'Password reset requested');
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const tokenHash = hashToken(token);
  const reset = await PasswordResetToken.findOneAndUpdate(
    {
      tokenHash,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { usedAt: new Date() } },
    { returnDocument: 'before' },
  );
  if (!reset) {
    throw badRequest('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  }
  const user = await User.findById(reset.userId);
  if (!user) {
    throw badRequest('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired.');
  }
  const passwordHash = await hashPassword(password);
  await User.updateOne(
    { _id: user._id },
    { $set: { passwordHash, failedLoginAttempts: 0, lockUntil: null } },
  );
  await PasswordResetToken.deleteMany({ userId: user._id, _id: { $ne: reset._id } });
  await revokeAllSessions(user._id.toString());
  securityLog.info({ userId: user._id.toString() }, 'Password reset completed');
}

export async function changePassword(
  req: Request,
  res: Response,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthResult> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user?.passwordHash) throw new AppError(401, 'UNAUTHENTICATED', 'Account not found.');
  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) {
    securityLog.warn({ userId }, 'Password change rejected: incorrect current password');
    throw badRequest('CURRENT_PASSWORD_INVALID', 'Your current password is incorrect.');
  }
  const same = await verifyPassword(newPassword, user.passwordHash);
  if (same) {
    throw badRequest('PASSWORD_UNCHANGED', 'Choose a password different from your current one.');
  }
  const passwordHash = await hashPassword(newPassword);
  await User.updateOne({ _id: user._id }, { $set: { passwordHash } });
  await revokeAllSessions(userId);
  const material = await createSession(userId, req.get('user-agent') ?? '');
  issueSession(res, material);
  securityLog.info({ userId }, 'Password changed; all sessions revoked');
  return { user: toAuthUser({ ...user.toObject(), email: user.email }), csrfToken: material.csrfToken };
}

export async function logout(req: Request, res: Response): Promise<void> {
  await revokeCurrentSession(req);
  clearAuthCookies(res);
}

export async function getProfile(userId: string): Promise<{
  user: AuthUser;
  recentGames: ProfileGame[];
}> {
  const user = await User.findById(userId).select('+email');
  if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account not found.');
  const sessions = await GameSession.find({ 'players.userId': new Types.ObjectId(userId), status: 'finished' })
    .sort({ endedAt: -1 })
    .limit(10)
    .lean();

  const recentGames: ProfileGame[] = sessions.map((session) => {
    const ranked = rankPlayers(
      session.players.map((player) => ({
        userId: player.userId.toString(),
        username: player.username,
        score: player.score,
        correctGuesses: player.correctGuesses,
        joinedAt: player.joinedAt,
      })),
    );
    const playerEntry = ranked.find((entry) => entry.userId === userId);
    return {
      id: session._id.toString(),
      roomCode: session.roomCode,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt ? session.endedAt.toISOString() : null,
      playerScore: playerEntry?.score ?? 0,
      playerRank: playerEntry?.rank ?? ranked.length,
      winnerName: session.winnerName ?? null,
      totalPlayers: ranked.length,
    };
  });

  return { user: toAuthUser({ ...user.toObject(), email: user.email }), recentGames };
}

export async function getGlobalLeaderboard(): Promise<LeaderboardEntry[]> {
  const users = await User.find({})
    .sort({ 'stats.totalPoints': -1, 'stats.wins': -1, 'stats.correctGuesses': -1 })
    .limit(100)
    .lean();
  const ordered = users
    .sort((a, b) => {
      const pointDiff = (b.stats?.totalPoints ?? 0) - (a.stats?.totalPoints ?? 0);
      if (pointDiff !== 0) return pointDiff;
      const winDiff = (b.stats?.wins ?? 0) - (a.stats?.wins ?? 0);
      if (winDiff !== 0) return winDiff;
      const guessDiff = (b.stats?.correctGuesses ?? 0) - (a.stats?.correctGuesses ?? 0);
      if (guessDiff !== 0) return guessDiff;
      const nameDiff = a.username.localeCompare(b.username, 'en', { sensitivity: 'base' });
      if (nameDiff !== 0) return nameDiff;
      return a._id.toString().localeCompare(b._id.toString());
    })
    .slice(0, 50);
  return ordered.map((user, index) => ({
    rank: index + 1,
    userId: user._id.toString(),
    username: user.username,
    score: user.stats?.totalPoints ?? 0,
    correctGuesses: user.stats?.correctGuesses ?? 0,
    connected: false,
  }));
}

export async function cleanupSessionsForUser(userId: string): Promise<void> {
  await Session.deleteMany({ userId });
}
