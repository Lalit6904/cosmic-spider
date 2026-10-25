import { z } from 'zod';
import {
  CHAT_LIMITS,
  DRAWING_LIMITS,
  GUESS_LIMITS,
  ROOM_LIMITS,
} from '../../shared/protocol';

const RESERVED_USERNAMES = new Set([
  'admin',
  'administrator',
  'system',
  'cosmic spider',
  'cosmicspider',
  'moderator',
  'support',
  'root',
]);

const usernameSchema = z
  .string({ error: 'Username is required' })
  .trim()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(/^[A-Za-z0-9_]+$/, 'Use letters, numbers and underscores only')
  .refine((value) => !RESERVED_USERNAMES.has(value.toLowerCase()), 'That username is reserved');

const passwordSchema = z
  .string({ error: 'Password is required' })
  .min(10, 'Password must be at least 10 characters')
  .max(72, 'Password must be at most 72 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((value) => /[a-zA-Z]/.test(value) && /[0-9]/.test(value), 'Use at least one letter and one number');

const emailSchema = z
  .string({ error: 'Email is required' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long')
  .email('Enter a valid email address');

/** Rejects terminal/control bytes without relying on a control-character regex. */
function hasDisallowedControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) {
      return true;
    }
  }
  return false;
}

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Password is required').max(72, 'Password is too long'),
  })
  .strict();

export const forgotPasswordSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: z.string().min(20).max(200),
    password: passwordSchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .strict();

export const roomCreateSchema = z
  .object({
    name: z.string().trim().min(3, 'Room name must be at least 3 characters').max(40, 'Room name is too long'),
    visibility: z.enum(['public', 'private']),
    maxPlayers: z.number().int().min(ROOM_LIMITS.minPlayers).max(ROOM_LIMITS.maxPlayers),
    roundDurationSeconds: z
      .number()
      .int()
      .min(ROOM_LIMITS.minRoundSeconds)
      .max(ROOM_LIMITS.maxRoundSeconds),
    totalRounds: z.number().int().min(ROOM_LIMITS.minRounds).max(ROOM_LIMITS.maxRounds),
  })
  .strict();

export const roomJoinSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z2-9]{6}$/, 'Enter a valid 6-character room code'),
  })
  .strict();

export const readySchema = z.object({ ready: z.boolean() }).strict();

export const drawingPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

export const drawingStrokeSchema = z
  .object({
    strokeId: z.uuid(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Invalid colour'),
    width: z.number().finite().min(1).max(40),
    tool: z.enum(['pen', 'eraser']),
    points: z.array(drawingPointSchema).min(1).max(DRAWING_LIMITS.maxPointsPerEvent),
  })
  .strict();

export const drawingEndSchema = z.object({ strokeId: z.uuid() }).strict();

export const guessSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'Type a guess')
      .max(GUESS_LIMITS.maxLength, 'Guess is too long')
      .refine((value) => !hasDisallowedControlCharacter(value), 'Invalid characters'),
  })
  .strict();

export const chatSchema = z
  .object({
    text: z
      .string()
      .trim()
      .min(1, 'Message is empty')
      .max(CHAT_LIMITS.maxLength, 'Message is too long')
      .refine((value) => !hasDisallowedControlCharacter(value), 'Invalid characters'),
  })
  .strict();

const userIdSchema = z.string().regex(/^[a-f0-9]{24}$/i, 'Invalid player');

export const moderationActionSchema = z
  .object({
    action: z.enum(['kick', 'mute', 'unmute']),
    targetUserId: userIdSchema,
  })
  .strict();

export const moderationReportSchema = z
  .object({
    targetUserId: userIdSchema,
    reason: z.string().trim().min(3, 'Give a short reason').max(500, 'Reason is too long'),
  })
  .strict();

export const emptySchema = z.object({}).strict();

export const roomCodeParamSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z2-9]{6}$/),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type DrawingStrokeInput = z.infer<typeof drawingStrokeSchema>;
export type RoomCreateInput = z.infer<typeof roomCreateSchema>;
