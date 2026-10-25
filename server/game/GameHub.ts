import {
  calculatePoints,
  maskWord,
  normalizeGuess,
  revealHintPositions,
  toLeaderboard,
} from '../../shared/game';
import {
  CHAT_LIMITS,
  DRAWING_LIMITS,
  GUESS_LIMITS,
  type ChatMessage,
  type DrawingStroke,
  type GameOverSummary,
  type HintState,
  type LeaderboardEntry,
  type MaskedGuess,
  type MaskedGuessFeed,
  type PublicRoomSummary,
  type RoomState,
  type RoomSummary,
  type RoomVisibility,
  type RoundResultView,
  type RoundStartedPayload,
} from '../../shared/protocol';
import type { Server } from 'socket.io';
import { Types } from 'mongoose';
import { pickWord } from './words';
import { GameRoom } from '../models/GameRoom';
import { GameSession } from '../models/GameSession';
import { GameResult } from '../models/GameResult';
import { ModerationRecord } from '../models/ModerationRecord';
import { User } from '../models/User';
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from '../lib/errors';
import { gameLog, logger, securityLog } from '../lib/logger';
import { randomId } from '../lib/crypto';

const ROUND_END_DELAY_MS = 6_000;
const DISCONNECT_DRAWER_GRACE_MS = 10_000;
const OWNER_TRANSFER_GRACE_MS = 30_000;
const EMPTY_ROOM_TTL_MS = 10 * 60_000;
const ROOM_MAX_AGE_MS = 6 * 60 * 60_000;
const MUTE_DURATION_MS = 5 * 60_000;

interface Player {
  userId: string;
  username: string;
  socketId: string | null;
  connected: boolean;
  score: number;
  correctGuesses: number;
  ready: boolean;
  joinedAt: number;
  guessedThisRound: boolean;
  roundPoints: number;
  guessCount: number;
  lastGuessAt: number;
  lastChatAt: number;
  mutedUntil: number | null;
}

interface RecordedGuess {
  id: string;
  roundNumber: number;
  userId: string;
  username: string;
  /** Server-only raw text. It is never broadcast before `revealed`. */
  text: string;
  correct: boolean;
  points: number;
  createdAt: number;
  revealed: boolean;
}

interface InternalRoom {
  id: string;
  dbId: Types.ObjectId;
  code: string;
  name: string;
  visibility: RoomVisibility;
  ownerId: string;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
  phase: 'lobby' | 'round' | 'roundEnd' | 'gameOver';
  roundNumber: number;
  currentDrawerId: string | null;
  lastDrawerId: string | null;
  turnOrder: string[];
  roundStartedAt: number | null;
  roundEndsAt: number | null;
  roundTimer: NodeJS.Timeout | null;
  roundToken: number;
  secretWord: string;
  revealedPositions: Set<number>;
  hintStage: number;
  players: Map<string, Player>;
  strokes: DrawingStroke[];
  strokePointCount: number;
  redoStack: DrawingStroke[];
  activeStroke: { socketId: string; strokeId: string } | null;
  chat: ChatMessage[];
  maskedGuesses: RecordedGuess[];
  lastRound: RoomSummary | null;
  gameOver: GameOverSummary | null;
  sessionId: Types.ObjectId | null;
  nextRoundTimer: NodeJS.Timeout | null;
  drawerDisconnectTimer: NodeJS.Timeout | null;
  ownerTransferTimer: NodeJS.Timeout | null;
  cleanupTimer: NodeJS.Timeout | null;
  createdAt: number;
  lastActivityAt: number;
  bannedUserIds: Set<string>;
}

export interface SessionUser {
  id: string;
  username: string;
}

export interface CreateRoomOptions {
  name: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function makeCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)] ?? 'X';
  }
  return code;
}

function systemMessage(text: string): ChatMessage {
  return {
    id: randomId(8),
    kind: 'system',
    userId: null,
    username: 'Cosmic Spider',
    text,
    createdAt: Date.now(),
  };
}

const MAX_GUESS_FEED = 60;

/** Full mask: no character of the submitted guess is exposed early. */
function maskGuess(text: string): string {
  return [...text].map((character) => (character === ' ' ? ' ' : '•')).join('');
}

function publicPlayer(player: Player, ownerId: string) {
  return {
    id: player.userId,
    username: player.username,
    score: player.score,
    correctGuesses: player.correctGuesses,
    connected: player.connected,
    ready: player.ready,
    isOwner: player.userId === ownerId,
    guessedThisRound: player.guessedThisRound,
    mutedUntil: player.mutedUntil,
  };
}

export class GameHub {
  private readonly rooms = new Map<string, InternalRoom>();
  private readonly userRooms = new Map<string, string>();
  private io: Server | null = null;
  private ticker: NodeJS.Timeout | null = null;

  attach(io: Server): void {
    this.io = io;
    if (!this.ticker) {
      this.ticker = setInterval(() => this.tick(), 1_000);
      this.ticker.unref?.();
    }
  }

  shutdown(): void {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const room of this.rooms.values()) {
      this.clearTimers(room);
    }
    this.rooms.clear();
    this.userRooms.clear();
  }

  getRoomCount(): number {
    return this.rooms.size;
  }

  listPublicRooms(): PublicRoomSummary[] {
    return [...this.rooms.values()]
      .filter((room) => room.visibility === 'public')
      .map((room) => ({
        code: room.code,
        name: room.name,
        playerCount: room.players.size,
        maxPlayers: room.maxPlayers,
        roundDurationSeconds: room.roundDurationSeconds,
        totalRounds: room.totalRounds,
        status: room.phase === 'lobby' ? ('waiting' as const) : ('playing' as const),
        ownerName: room.players.get(room.ownerId)?.username ?? 'Unknown',
        updatedAt: room.lastActivityAt,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 60);
  }

  async createRoom(user: SessionUser, options: CreateRoomOptions): Promise<{ code: string; roomId: string }> {
    if (this.userRooms.has(user.id)) {
      throw conflict('ALREADY_IN_ROOM', 'Leave your current room before creating another.');
    }
    const ownedCount = [...this.rooms.values()].filter(
      (room) => room.ownerId === user.id && room.phase !== 'gameOver',
    ).length;
    if (ownedCount >= 2) {
      throw conflict('ROOM_LIMIT', 'You can own at most two active rooms.');
    }

    let code = makeCode();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existsInMemory = [...this.rooms.values()].some((room) => room.code === code);
      const existsInDb = await GameRoom.exists({ code });
      if (!existsInMemory && !existsInDb) break;
      code = makeCode();
    }

    const dbRoom = await GameRoom.create({
      code,
      name: options.name,
      ownerId: new Types.ObjectId(user.id),
      visibility: options.visibility,
      maxPlayers: options.maxPlayers,
      roundDurationSeconds: options.roundDurationSeconds,
      totalRounds: options.totalRounds,
      status: 'open',
    });

    const now = Date.now();
    const room: InternalRoom = {
      id: dbRoom._id.toString(),
      dbId: dbRoom._id,
      code,
      name: options.name,
      visibility: options.visibility,
      ownerId: user.id,
      maxPlayers: options.maxPlayers,
      roundDurationSeconds: options.roundDurationSeconds,
      totalRounds: options.totalRounds,
      phase: 'lobby',
      roundNumber: 0,
      currentDrawerId: null,
      lastDrawerId: null,
      turnOrder: [],
      roundStartedAt: null,
      roundEndsAt: null,
      roundTimer: null,
      roundToken: 0,
      secretWord: '',
      revealedPositions: new Set(),
      hintStage: 0,
      players: new Map(),
      strokes: [],
      strokePointCount: 0,
      redoStack: [],
      activeStroke: null,
      chat: [],
      maskedGuesses: [],
      lastRound: null,
      gameOver: null,
      sessionId: null,
      nextRoundTimer: null,
      drawerDisconnectTimer: null,
      ownerTransferTimer: null,
      cleanupTimer: null,
      createdAt: now,
      lastActivityAt: now,
      bannedUserIds: new Set(),
    };
    this.rooms.set(room.id, room);
    gameLog.info({ roomId: room.id, code, ownerId: user.id }, 'Room created');
    return { code, roomId: room.id };
  }

  joinRoom(
    user: SessionUser,
    code: string,
    socketId: string,
  ): { roomId: string; channel: string; state: RoomState } {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
    if (!room) throw notFound('That room code does not exist or the room has closed.');
    if (room.bannedUserIds.has(user.id)) throw forbidden('You were removed from this room.');

    const existingMembership = this.userRooms.get(user.id);
    if (existingMembership && existingMembership !== room.id) {
      throw conflict('ALREADY_IN_ROOM', 'Leave your current room before joining another.');
    }

    const existingPlayer = room.players.get(user.id);
    let player = existingPlayer;
    if (!player) {
      if (room.phase !== 'lobby') {
        throw conflict('GAME_IN_PROGRESS', 'This game is already in progress. Only reconnecting players can rejoin.');
      }
      if (room.players.size >= room.maxPlayers) {
        throw conflict('ROOM_FULL', 'That room is full.');
      }
      player = {
        userId: user.id,
        username: user.username,
        socketId,
        connected: true,
        score: 0,
        correctGuesses: 0,
        ready: false,
        joinedAt: Date.now(),
        guessedThisRound: false,
        roundPoints: 0,
        guessCount: 0,
        lastGuessAt: 0,
        lastChatAt: 0,
        mutedUntil: null,
      };
      room.players.set(user.id, player);
      room.chat.push(systemMessage(`${user.username} entered the room.`));
      this.trimChat(room);
    } else {
      if (player.connected && player.socketId && player.socketId !== socketId) {
        // The socket layer closes the previous connection; the newest one wins.
      }
      player.connected = true;
      player.socketId = socketId;
      player.username = user.username;
      if (room.drawerDisconnectTimer) {
        clearTimeout(room.drawerDisconnectTimer);
        room.drawerDisconnectTimer = null;
      }
      if (room.ownerTransferTimer) {
        clearTimeout(room.ownerTransferTimer);
        room.ownerTransferTimer = null;
      }
    }

    this.userRooms.set(user.id, room.id);
    this.cancelCleanup(room);
    room.lastActivityAt = Date.now();

    if (player.userId === room.ownerId) {
      this.cancelOwnerTransfer(room);
    }
    if (room.phase === 'round' && room.currentDrawerId === user.id) {
      this.cancelDrawerDisconnect(room);
    }

    this.io?.sockets.sockets.get(socketId)?.join(roomChannel(room.id));
    if (room.players.size > 1) {
      this.emitToRoom(room, 'room:playerJoined', { userId: user.id, username: user.username });
      this.broadcastChat(room, room.chat[room.chat.length - 1]!);
    }
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, userId: user.id, reconnected: Boolean(existingPlayer) }, 'Player joined room');
    return { roomId: room.id, channel: roomChannel(room.id), state: this.getRoomState(room, user.id) };
  }

  async leaveRoom(userId: string, reason: 'leave' | 'kick' = 'leave'): Promise<void> {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player) return;
    const username = player.username;
    const wasDrawer = room.phase === 'round' && room.currentDrawerId === userId;
    const wasOwner = room.ownerId === userId;

    if (reason === 'kick') {
      room.bannedUserIds.add(userId);
    }
    room.players.delete(userId);
    this.userRooms.delete(userId);
    room.lastActivityAt = Date.now();
    if (player.socketId) {
      const socket = this.io?.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.leave(roomChannel(room.id));
        socket.data.roomId = null;
      }
    }

    if (wasDrawer && room.phase === 'round') {
      await this.finishRound(room, 'drawerLeft');
    }
    if (wasOwner) {
      this.transferOwnership(room);
    }

    const message = systemMessage(`${username} ${reason === 'kick' ? 'was removed from the room' : 'left the room'}.`);
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    this.emitToRoom(room, 'room:playerLeft', { userId, username, reason });
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, userId, reason }, 'Player left room');

    if (room.players.size === 0) {
      await this.closeRoom(room, 'empty');
    } else {
      this.scheduleCleanup(room);
    }
  }

  async disconnectSocket(userId: string): Promise<void> {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player || !player.connected) return;
    player.connected = false;
    player.socketId = null;
    room.lastActivityAt = Date.now();
    this.emitRoomState(room);

    if (room.phase === 'round' && room.currentDrawerId === userId) {
      this.cancelDrawerDisconnect(room);
      room.drawerDisconnectTimer = setTimeout(() => {
        void (async () => {
          const current = this.rooms.get(room.id);
          const drawer = current?.players.get(userId);
          if (current && current.phase === 'round' && current.currentDrawerId === userId && drawer && !drawer.connected) {
            await this.finishRound(current, 'drawerLeft');
          }
        })();
      }, DISCONNECT_DRAWER_GRACE_MS);
      room.drawerDisconnectTimer.unref?.();
    }

    if (room.ownerId === userId) {
      this.cancelOwnerTransfer(room);
      room.ownerTransferTimer = setTimeout(() => {
        const current = this.rooms.get(room.id);
        if (current && current.ownerId === userId && !current.players.get(userId)?.connected) {
          this.transferOwnership(current);
          this.emitRoomState(current);
        }
      }, OWNER_TRANSFER_GRACE_MS);
      room.ownerTransferTimer.unref?.();
    }

    if (![...room.players.values()].some((candidate) => candidate.connected)) {
      this.scheduleCleanup(room);
    }
  }

  setReady(userId: string, ready: boolean): void {
    const room = this.requireRoom(userId);
    if (room.phase !== 'lobby') throw conflict('INVALID_PHASE', 'Ready state can only change in the lobby.');
    const player = this.requirePlayer(room, userId);
    player.ready = ready;
    this.emitRoomState(room);
  }

  async startGame(userId: string): Promise<void> {
    const room = this.requireRoom(userId);
    if (room.ownerId !== userId) throw forbidden('Only the room owner can start the game.');
    if (room.phase !== 'lobby') throw conflict('INVALID_PHASE', 'The game has already started.');
    const connected = [...room.players.values()].filter((player) => player.connected);
    if (connected.length < 2) throw conflict('NOT_ENOUGH_PLAYERS', 'You need at least two connected players.');
    if (!connected.every((player) => player.ready)) throw conflict('NOT_READY', 'Every connected player must be ready.');

    room.phase = 'roundEnd';
    room.roundNumber = 0;
    room.gameOver = null;
    room.lastRound = null;
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.turnOrder = connected.sort((a, b) => a.joinedAt - b.joinedAt).map((player) => player.userId);
    for (const player of room.players.values()) {
      player.score = 0;
      player.correctGuesses = 0;
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.ready = false;
    }

    const session = await GameSession.create({
      roomId: room.dbId,
      roomCode: room.code,
      players: connected.map((player) => ({
        userId: new Types.ObjectId(player.userId),
        username: player.username,
        score: 0,
        correctGuesses: 0,
        joinedAt: player.joinedAt,
      })),
      status: 'active',
      startedAt: new Date(),
    });
    room.sessionId = session._id;
    const message = systemMessage('The game begins. Good luck, stargazers!');
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    gameLog.info({ roomId: room.id, sessionId: session._id.toString(), players: connected.length }, 'Game started');
    await this.beginRound(room);
  }

  async playAgain(userId: string): Promise<void> {
    const room = this.requireRoom(userId);
    if (room.ownerId !== userId) throw forbidden('Only the room owner can start another game.');
    if (room.phase !== 'gameOver') throw conflict('INVALID_PHASE', 'The game is not over yet.');
    this.clearRoundTimers(room);
    room.phase = 'lobby';
    room.roundNumber = 0;
    room.currentDrawerId = null;
    room.lastDrawerId = null;
    room.roundStartedAt = null;
    room.roundEndsAt = null;
    room.secretWord = '';
    room.revealedPositions.clear();
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.lastRound = null;
    room.gameOver = null;
    room.sessionId = null;
    room.turnOrder = [];
    for (const player of room.players.values()) {
      player.score = 0;
      player.correctGuesses = 0;
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.ready = false;
    }
    const message = systemMessage('The room is back in the lobby. Ready up for another game.');
    room.chat.push(message);
    this.broadcastChat(room, message);
    this.emitRoomState(room);
  }

  getState(userId: string): RoomState {
    const room = this.requireRoom(userId);
    return this.getRoomState(room, userId);
  }

  async submitGuess(
    userId: string,
    rawGuess: string,
  ): Promise<{ correct: boolean; points: number; allGuessed: boolean }> {
    const room = this.requireRoom(userId);
    const player = this.requirePlayer(room, userId);
    if (room.phase !== 'round' || !room.currentDrawerId) {
      throw conflict('NO_ACTIVE_ROUND', 'There is no active round to guess in.');
    }
    if (room.currentDrawerId === userId) throw forbidden('The drawer cannot guess their own word.');
    if (player.guessedThisRound) throw conflict('ALREADY_GUESSED', 'You already guessed this round.');
    if (player.guessCount >= GUESS_LIMITS.attemptsPerRound) {
      throw tooManyRequests('You have used all guesses for this round.');
    }
    const now = Date.now();
    if (now - player.lastGuessAt < GUESS_LIMITS.cooldownMs) {
      throw tooManyRequests('Guesses are limited to one per second.', GUESS_LIMITS.cooldownMs);
    }
    player.lastGuessAt = now;
    player.guessCount += 1;

    if (room.roundEndsAt == null || now >= room.roundEndsAt) {
      void this.finishRound(room, 'timeout');
      throw conflict('ROUND_ENDED', 'Time is up for this round.');
    }

    const normalized = normalizeGuess(rawGuess);
    if (normalized !== normalizeGuess(room.secretWord)) {
      this.recordGuess(room, player, rawGuess, false, 0);
      // The dedicated feed event carries the update; a full room-state fan-out
      // on every wrong guess would be needlessly expensive.
      this.emitGuessFeed(room);
      return { correct: false, points: 0, allGuessed: false };
    }

    const remainingMs = Math.max(0, room.roundEndsAt - now);
    const points = calculatePoints(remainingMs);
    player.guessedThisRound = true;
    player.score += points;
    player.roundPoints += points;
    player.correctGuesses += 1;
    // Guesses live in their own feed, never in room chat.
    this.recordGuess(room, player, rawGuess, true, points);

    const allGuessed = this.allEligibleGuessed(room);
    if (allGuessed) this.revealGuesses(room);
    // Persist before acknowledging so a following round/game transition cannot
    // outrun the score write and observe stale statistics.
    await this.persistGuess(room, player, points, remainingMs);
    this.emitGuessFeed(room);
    this.emitToRoom(room, 'score:updated', { leaderboard: this.leaderboard(room) });
    this.emitRoomState(room);
    if (allGuessed) {
      // End asynchronously after this handler has returned its acknowledgement.
      setImmediate(() => void this.finishRound(room, 'allGuessed'));
    }
    return { correct: true, points, allGuessed };
  }

  submitChat(userId: string, text: string): ChatMessage {
    const room = this.requireRoom(userId);
    const player = this.requirePlayer(room, userId);
    if (player.mutedUntil != null && player.mutedUntil > Date.now()) {
      throw forbidden('You are muted in this room.');
    }
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_LIMITS.cooldownMs) {
      throw tooManyRequests('You are sending messages too quickly.', CHAT_LIMITS.cooldownMs);
    }
    player.lastChatAt = now;
    const message: ChatMessage = {
      id: randomId(8),
      kind: 'player',
      userId,
      username: player.username,
      text,
      createdAt: now,
    };
    room.chat.push(message);
    this.trimChat(room);
    room.lastActivityAt = now;
    this.broadcastChat(room, message);
    return message;
  }

  addStroke(
    userId: string,
    socketId: string,
    stroke: Omit<DrawingStroke, 'points'> & { points: DrawingStroke['points'] },
  ): void {
    const room = this.requireRoom(userId);
    if (room.phase !== 'round') throw conflict('NO_ACTIVE_ROUND', 'Drawing is only available during a round.');
    if (room.currentDrawerId !== userId) throw forbidden('Only the active drawer can draw.');
    if (room.activeStroke && room.activeStroke.strokeId !== stroke.id) {
      // Starting a new stroke implicitly ends the prior one.
      room.activeStroke = null;
    }
    if (room.activeStroke && room.activeStroke.socketId !== socketId) {
      throw conflict('STROKE_IN_PROGRESS', 'Another stroke is already in progress.');
    }

    const existing = room.strokes.find((candidate) => candidate.id === stroke.id);
    if (!existing) {
      if (room.strokes.length >= DRAWING_LIMITS.maxStrokes) {
        throw conflict('CANVAS_FULL', 'The canvas is full. Clear it to continue.');
      }
      const created: DrawingStroke = {
        id: stroke.id,
        color: stroke.color,
        width: stroke.width,
        tool: stroke.tool,
        points: [...stroke.points],
      };
      room.strokes.push(created);
      room.strokePointCount += created.points.length;
      room.activeStroke = { socketId, strokeId: stroke.id };
      room.redoStack = [];
    } else {
      if (existing.color !== stroke.color || existing.width !== stroke.width || existing.tool !== stroke.tool) {
        throw badRequest('STROKE_MISMATCH', 'Stroke settings cannot change mid-stroke.');
      }
      if (room.activeStroke?.strokeId === stroke.id && room.activeStroke.socketId !== socketId) {
        throw forbidden('You cannot extend another player\'s stroke.');
      }
      if (room.strokePointCount + stroke.points.length > DRAWING_LIMITS.maxCanvasPoints) {
        throw conflict('CANVAS_FULL', 'The canvas reached its size limit. Clear it to continue.');
      }
      existing.points.push(...stroke.points);
      room.strokePointCount += stroke.points.length;
      room.activeStroke = { socketId, strokeId: stroke.id };
    }

    room.lastActivityAt = Date.now();
    const event = existing ?? room.strokes[room.strokes.length - 1]!;
    this.io?.to(roomChannel(room.id)).except(socketId).emit('drawing:stroke', {
      ...event,
      points: stroke.points,
    } satisfies DrawingStroke);
  }

  endStroke(userId: string, strokeId: string): void {
    const room = this.requireRoom(userId);
    if (room.currentDrawerId !== userId) throw forbidden('Only the active drawer can draw.');
    if (room.activeStroke?.strokeId === strokeId) room.activeStroke = null;
  }

  undoStroke(userId: string): void {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    if (room.strokes.length === 0) throw conflict('NOTHING_TO_UNDO', 'There is nothing to undo.');
    if (room.redoStack.length >= DRAWING_LIMITS.maxUndoDepth) room.redoStack.shift();
    const removed = room.strokes.pop();
    if (!removed) return;
    room.strokePointCount -= removed.points.length;
    room.redoStack.push(removed);
    room.activeStroke = null;
    this.broadcastDrawingSync(room);
  }

  redoStroke(userId: string): void {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    const restored = room.redoStack.pop();
    if (!restored) throw conflict('NOTHING_TO_REDO', 'There is nothing to redo.');
    if (room.strokes.length >= DRAWING_LIMITS.maxStrokes) throw conflict('CANVAS_FULL', 'The canvas is full.');
    if (room.strokePointCount + restored.points.length > DRAWING_LIMITS.maxCanvasPoints) {
      room.redoStack.push(restored);
      throw conflict('CANVAS_FULL', 'The canvas reached its size limit.');
    }
    room.strokes.push(restored);
    room.strokePointCount += restored.points.length;
    room.activeStroke = null;
    this.broadcastDrawingSync(room);
  }

  clearDrawing(userId: string): void {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    this.io?.to(roomChannel(room.id)).emit('drawing:clear', {});
    this.emitRoomState(room);
  }

  async moderationAction(
    actorId: string,
    action: 'kick' | 'mute' | 'unmute',
    targetId: string,
  ): Promise<void> {
    const room = this.requireRoom(actorId);
    if (room.ownerId !== actorId) throw forbidden('Only the room owner can moderate players.');
    if (actorId === targetId) throw badRequest('INVALID_TARGET', 'You cannot moderate yourself.');
    const target = room.players.get(targetId);
    if (!target) throw notFound('That player is not in this room.');

    if (action === 'kick') {
      await ModerationRecord.create({
        kind: 'kick',
        roomCode: room.code,
        actorId: new Types.ObjectId(actorId),
        targetId: new Types.ObjectId(targetId),
        reason: 'Removed by room owner',
      });
      const targetSocketId = target.socketId;
      this.appendSystemMessage(room, `${target.username} was removed by the room owner.`);
      await this.leaveRoom(targetId, 'kick');
      if (targetSocketId) {
        const targetSocket = this.io?.sockets.sockets.get(targetSocketId);
        targetSocket?.emit('error', { code: 'KICKED', message: 'The room owner removed you from the room.' });
        targetSocket?.disconnect(true);
      }
      securityLog.info({ roomId: room.id, actorId, targetId, action }, 'Moderation action applied');
      return;
    }

    target.mutedUntil = action === 'mute' ? Date.now() + MUTE_DURATION_MS : null;
    await ModerationRecord.create({
      kind: action,
      roomCode: room.code,
      actorId: new Types.ObjectId(actorId),
      targetId: new Types.ObjectId(targetId),
      reason: action === 'mute' ? 'Muted by room owner' : 'Unmuted by room owner',
    });
    this.appendSystemMessage(
      room,
      `${target.username} was ${action === 'mute' ? 'muted for five minutes' : 'unmuted'}.`,
    );
    this.emitRoomState(room);
    securityLog.info({ roomId: room.id, actorId, targetId, action }, 'Moderation action applied');
  }

  async reportPlayer(actorId: string, targetId: string, reason: string): Promise<void> {
    const room = this.requireRoom(actorId);
    if (actorId === targetId) throw badRequest('INVALID_TARGET', 'You cannot report yourself.');
    if (!room.players.has(targetId)) throw notFound('That player is not in this room.');
    await ModerationRecord.create({
      kind: 'report',
      roomCode: room.code,
      actorId: new Types.ObjectId(actorId),
      targetId: new Types.ObjectId(targetId),
      reason,
    });
    securityLog.warn({ roomId: room.id, actorId, targetId }, 'Player report filed');
  }

  private async beginRound(room: InternalRoom): Promise<void> {
    if (room.phase === 'gameOver') return;
    const connected = [...room.players.values()].filter((player) => player.connected);
    if (connected.length < 2) {
      await this.finishGame(room);
      return;
    }
    const nextDrawer = this.chooseNextDrawer(room);
    if (!nextDrawer) {
      await this.finishGame(room);
      return;
    }
    const drawablePlayers = connected.filter((player) => player.userId !== nextDrawer.userId);
    if (drawablePlayers.length === 0) {
      await this.finishGame(room);
      return;
    }

    this.clearRoundTimers(room);
    room.roundNumber += 1;
    room.phase = 'round';
    room.currentDrawerId = nextDrawer.userId;
    room.lastDrawerId = nextDrawer.userId;
    room.roundStartedAt = Date.now();
    room.roundEndsAt = room.roundStartedAt + room.roundDurationSeconds * 1_000;
    room.roundToken += 1;
    room.secretWord = pickWord();
    room.revealedPositions = new Set();
    room.hintStage = 0;
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.lastRound = null;
    room.lastActivityAt = Date.now();
    for (const player of room.players.values()) {
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.lastGuessAt = 0;
      player.ready = false;
    }

    const token = room.roundToken;
    room.roundTimer = setTimeout(() => {
      if (room.roundToken === token) void this.finishRound(room, 'timeout');
    }, room.roundDurationSeconds * 1_000 + 20);
    room.roundTimer.unref?.();

    const initialHint = this.hint(room);
    for (const player of room.players.values()) {
      const socket = player.socketId ? this.io?.sockets.sockets.get(player.socketId) : null;
      if (!socket) continue;
      const payload: RoundStartedPayload = {
        roundNumber: room.roundNumber,
        drawerId: room.currentDrawerId,
        drawerName: nextDrawer.username,
        endsAt: room.roundEndsAt,
        serverNow: Date.now(),
        hint: initialHint,
        ...(player.userId === room.currentDrawerId ? { word: room.secretWord } : {}),
      };
      socket.emit('game:roundStarted', payload);
    }
    const message = systemMessage(
      `Round ${room.roundNumber} of ${room.totalRounds}: ${nextDrawer.username} is drawing.`,
    );
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    this.emitRoomState(room);
    this.emitTimer(room);
    gameLog.info(
      { roomId: room.id, roomCode: room.code, round: room.roundNumber, drawerId: nextDrawer.userId },
      'Round started',
    );
  }

  private async finishRound(room: InternalRoom, reason: RoomSummary['reason']): Promise<void> {
    if (room.phase !== 'round') return;
    room.phase = 'roundEnd';
    room.roundToken += 1;
    this.clearRoundTimers(room);
    room.roundEndsAt = null;
    room.activeStroke = null;

    const summary = this.makeRoundSummary(room, reason);
    room.lastRound = summary;
    // The word is revealed through the round overlay and summary only. Chat is
    // reserved for player conversation, and guesses never leak through it.
    this.emitToRoom(room, 'game:roundEnded', summary);
    this.emitToRoom(room, 'leaderboard:updated', { leaderboard: this.leaderboard(room) });
    await this.persistRound(room, summary);
    this.emitRoomState(room);

    if (room.roundNumber >= room.totalRounds) {
      await this.finishGame(room);
      return;
    }

    room.nextRoundTimer = setTimeout(() => {
      void this.beginRound(room);
    }, ROUND_END_DELAY_MS);
    room.nextRoundTimer.unref?.();
  }

  private async finishGame(room: InternalRoom): Promise<void> {
    if (room.phase === 'gameOver') return;
    this.clearRoundTimers(room);
    room.phase = 'gameOver';
    room.currentDrawerId = null;
    room.roundEndsAt = null;
    room.activeStroke = null;
    const standings = this.leaderboard(room);
    const winner = standings[0];
    if (!winner) {
      await this.closeRoom(room, 'no-players');
      return;
    }
    room.gameOver = {
      winnerId: winner.userId,
      winnerName: winner.username,
      standings,
    };

    if (room.sessionId) {
      const sessionId = room.sessionId;
      const finished = await GameSession.findOneAndUpdate(
        { _id: sessionId, status: 'active' },
        {
          $set: {
            status: 'finished',
            winnerId: new Types.ObjectId(winner.userId),
            winnerName: winner.username,
            endedAt: new Date(),
            players: [...room.players.values()].map((player) => ({
              userId: new Types.ObjectId(player.userId),
              username: player.username,
              score: player.score,
              correctGuesses: player.correctGuesses,
              joinedAt: player.joinedAt,
            })),
          },
        },
        { returnDocument: 'after' },
      );
      if (finished) {
        await this.applyGameStats(room, winner.userId);
      }
    }

    const message = systemMessage(`${winner.username} wins the game with ${winner.score} points!`);
    room.chat.push(message);
    this.broadcastChat(room, message);
    this.emitToRoom(room, 'game:over', room.gameOver);
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, winnerId: winner.userId, score: winner.score }, 'Game finished');
  }

  private async applyGameStats(room: InternalRoom, winnerId: string): Promise<void> {
    try {
      const players = [...room.players.values()];
      await Promise.all(
        players.map((player) =>
          User.updateOne(
            { _id: player.userId },
            {
              $inc: {
                'stats.gamesPlayed': 1,
                ...(player.userId === winnerId ? { 'stats.wins': 1 } : {}),
              },
            },
          ),
        ),
      );
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, 'Failed to persist game-level statistics');
    }
  }

  private async persistGuess(
    room: InternalRoom,
    player: Player,
    points: number,
    remainingMs: number,
  ): Promise<void> {
    if (!room.sessionId) return;
    try {
      const result = await GameResult.updateOne(
        {
          sessionId: room.sessionId,
          roundNumber: room.roundNumber,
          userId: new Types.ObjectId(player.userId),
        },
        {
          $setOnInsert: {
            sessionId: room.sessionId,
            roomCode: room.code,
            roundNumber: room.roundNumber,
            userId: new Types.ObjectId(player.userId),
            username: player.username,
            points,
            remainingMs,
            guessedAt: new Date(),
            appliedToUser: false,
          },
        },
        { upsert: true },
      );
      if (result.upsertedCount === 1) {
        await User.updateOne(
          { _id: player.userId },
          { $inc: { 'stats.correctGuesses': 1, 'stats.totalPoints': points } },
        );
        await GameResult.updateOne(
          { sessionId: room.sessionId, roundNumber: room.roundNumber, userId: player.userId },
          { $set: { appliedToUser: true } },
        );
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id, userId: player.userId }, 'Failed to persist score result');
    }
  }

  private async persistRound(room: InternalRoom, summary: RoomSummary): Promise<void> {
    if (!room.sessionId) return;
    try {
      await GameSession.updateOne(
        { _id: room.sessionId, status: 'active' },
        {
          $set: {
            roundsPlayed: room.roundNumber,
            players: [...room.players.values()].map((player) => ({
              userId: new Types.ObjectId(player.userId),
              username: player.username,
              score: player.score,
              correctGuesses: player.correctGuesses,
              joinedAt: player.joinedAt,
            })),
          },
        },
      );
    } catch (error) {
      logger.error({ err: error, roomId: room.id, round: summary.roundNumber }, 'Failed to persist round');
    }
  }

  private makeRoundSummary(room: InternalRoom, reason: RoomSummary['reason']): RoomSummary {
    const drawer = room.currentDrawerId ? room.players.get(room.currentDrawerId) : undefined;
    const results: RoundResultView[] = [...room.players.values()]
      .filter((player) => player.guessedThisRound)
      .sort((a, b) => b.roundPoints - a.roundPoints || a.joinedAt - b.joinedAt)
      .map((player) => ({
        userId: player.userId,
        username: player.username,
        points: player.roundPoints,
        correctGuesses: player.correctGuesses,
      }));
    return {
      roundNumber: room.roundNumber,
      drawerId: drawer?.userId ?? '',
      drawerName: drawer?.username ?? 'Unknown',
      word: room.secretWord,
      reason,
      results,
    };
  }

  private recordGuess(
    room: InternalRoom,
    player: Player,
    text: string,
    correct: boolean,
    points: number,
  ): void {
    room.maskedGuesses.push({
      id: randomId(8),
      roundNumber: room.roundNumber,
      userId: player.userId,
      username: player.username,
      text,
      correct,
      points,
      createdAt: Date.now(),
      revealed: false,
    });
    if (room.maskedGuesses.length > MAX_GUESS_FEED) {
      room.maskedGuesses = room.maskedGuesses.slice(-MAX_GUESS_FEED);
    }
  }

  /** Raw guess text becomes visible only once every eligible guesser has guessed. */
  private revealGuesses(room: InternalRoom): void {
    for (const guess of room.maskedGuesses) {
      if (guess.roundNumber === room.roundNumber) guess.revealed = true;
    }
  }

  private guessFeed(room: InternalRoom): MaskedGuessFeed {
    const guesses: MaskedGuess[] = room.maskedGuesses.map((guess) => ({
      id: guess.id,
      roundNumber: guess.roundNumber,
      userId: guess.userId,
      username: guess.username,
      masked: maskGuess(guess.text),
      text: guess.revealed ? guess.text : null,
      correct: guess.correct,
      points: guess.points,
      createdAt: guess.createdAt,
      revealed: guess.revealed,
    }));
    return { roundNumber: room.roundNumber, guesses };
  }

  private emitGuessFeed(room: InternalRoom): void {
    this.emitToRoom(room, 'guess:masked', this.guessFeed(room));
  }

  private allEligibleGuessed(room: InternalRoom): boolean {
    return [...room.players.values()]
      .filter((player) => player.connected && player.userId !== room.currentDrawerId)
      .every((player) => player.guessedThisRound);
  }

  private chooseNextDrawer(room: InternalRoom): Player | null {
    const connectedOrder = room.turnOrder.filter((userId) => room.players.get(userId)?.connected);
    for (const player of room.players.values()) {
      if (player.connected && !connectedOrder.includes(player.userId)) connectedOrder.push(player.userId);
    }
    if (connectedOrder.length === 0) return null;
    const lastIndex = room.lastDrawerId ? connectedOrder.indexOf(room.lastDrawerId) : -1;
    for (let offset = 1; offset <= connectedOrder.length; offset += 1) {
      const candidateId = connectedOrder[(lastIndex + offset) % connectedOrder.length];
      if (!candidateId) continue;
      const candidate = room.players.get(candidateId);
      if (candidate?.connected) return candidate;
    }
    return null;
  }

  private tick(): void {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.phase === 'round' && room.roundEndsAt != null) {
        if (now >= room.roundEndsAt) {
          void this.finishRound(room, 'timeout');
          continue;
        }
        this.updateHints(room, now);
        this.emitTimer(room);
      }
      if (room.players.size === 0 || now - room.lastActivityAt > ROOM_MAX_AGE_MS) {
        void this.closeRoom(room, 'stale');
        continue;
      }
      if (this.isRoomEmptyAndExpired(room, now)) {
        void this.closeRoom(room, 'empty');
      }
    }
  }

  private updateHints(room: InternalRoom, now: number): void {
    if (room.roundStartedAt == null || room.roundEndsAt == null) return;
    const total = room.roundEndsAt - room.roundStartedAt;
    const elapsed = now - room.roundStartedAt;
    const ratio = elapsed / total;
    const desired =
      ratio >= 0.66 ? 3 : ratio >= 0.33 ? 1 : 0;
    if (desired <= room.hintStage) return;
    room.hintStage = desired;
    room.revealedPositions = revealHintPositions(room.secretWord, room.revealedPositions, desired);
    const hint = this.hint(room);
    this.emitToRoom(room, 'game:hint', hint);
    this.emitRoomState(room);
  }

  private hint(room: InternalRoom): HintState {
    const letters = [...room.secretWord].filter((character) => /[a-z]/i.test(character)).length;
    return {
      masked: maskWord(room.secretWord, room.revealedPositions),
      revealedPositions: [...room.revealedPositions].sort((a, b) => a - b),
      length: room.secretWord.length,
      lettersRemaining: Math.max(0, letters - room.revealedPositions.size),
    };
  }

  private emitTimer(room: InternalRoom): void {
    if (room.phase !== 'round' || room.roundEndsAt == null) return;
    const now = Date.now();
    this.emitToRoom(room, 'game:timerUpdate', {
      roundNumber: room.roundNumber,
      endsAt: room.roundEndsAt,
      serverNow: now,
      remainingMs: Math.max(0, room.roundEndsAt - now),
    });
  }

  getRoomState(room: InternalRoom, viewerId: string): RoomState {
    const drawer = room.currentDrawerId ? room.players.get(room.currentDrawerId) : undefined;
    const leaderboard = this.leaderboard(room);
    const isDrawer = room.phase === 'round' && room.currentDrawerId === viewerId;
    const hint =
      room.phase === 'round' || room.phase === 'roundEnd' ? (isDrawer ? null : this.hint(room)) : null;
    const connected = [...room.players.values()].filter((player) => player.connected);
    const canStart =
      room.phase === 'lobby' &&
      room.ownerId === viewerId &&
      connected.length >= 2 &&
      connected.every((player) => player.ready);

    return {
      id: room.id,
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      ownerId: room.ownerId,
      maxPlayers: room.maxPlayers,
      roundDurationSeconds: room.roundDurationSeconds,
      totalRounds: room.totalRounds,
      phase: room.phase,
      roundNumber: room.roundNumber,
      currentDrawerId: room.currentDrawerId,
      currentDrawerName: drawer?.username ?? null,
      roundEndsAt: room.roundEndsAt,
      serverNow: Date.now(),
      word: isDrawer ? room.secretWord : null,
      hint,
      players: [...room.players.values()].map((player) => publicPlayer(player, room.ownerId)),
      leaderboard,
      chat: room.chat,
      maskedGuesses: this.guessFeed(room).guesses,
      lastRound: room.lastRound,
      gameOver: room.gameOver,
      canStart,
      strokes: room.phase === 'lobby' ? [] : room.strokes,
      canDraw: isDrawer,
      canUndo: isDrawer && room.strokes.length > 0,
      canRedo: isDrawer && room.redoStack.length > 0,
    };
  }

  private leaderboard(room: InternalRoom): LeaderboardEntry[] {
    return toLeaderboard(
      [...room.players.values()].map((player) => ({
        userId: player.userId,
        username: player.username,
        score: player.score,
        correctGuesses: player.correctGuesses,
        joinedAt: player.joinedAt,
        connected: player.connected,
      })),
    );
  }

  private emitRoomState(room: InternalRoom): void {
    for (const player of room.players.values()) {
      if (!player.socketId) continue;
      const socket = this.io?.sockets.sockets.get(player.socketId);
      socket?.emit('room:state', this.getRoomState(room, player.userId));
    }
  }

  private emitToRoom<T>(room: InternalRoom, event: string, payload: T): void {
    this.io?.to(roomChannel(room.id)).emit(event, payload);
  }

  private broadcastChat(room: InternalRoom, message: ChatMessage): void {
    this.emitToRoom(room, 'chat:message', message);
  }

  private appendSystemMessage(room: InternalRoom, text: string): void {
    const message = systemMessage(text);
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
  }

  private trimChat(room: InternalRoom): void {
    if (room.chat.length > CHAT_LIMITS.maxHistory) {
      room.chat = room.chat.slice(-CHAT_LIMITS.maxHistory);
    }
  }

  private broadcastDrawingSync(room: InternalRoom): void {
    this.emitToRoom(room, 'drawing:sync', { strokes: room.strokes });
    this.emitRoomState(room);
  }

  private assertDrawer(room: InternalRoom, userId: string): void {
    if (room.phase !== 'round') throw conflict('NO_ACTIVE_ROUND', 'There is no active round.');
    if (room.currentDrawerId !== userId) throw forbidden('Only the active drawer can do that.');
  }

  private requireRoom(userId: string): InternalRoom {
    const roomId = this.userRooms.get(userId);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) throw forbidden('You are not in a room.');
    return room;
  }

  private getRoomForUser(userId: string): InternalRoom | null {
    const roomId = this.userRooms.get(userId);
    return roomId ? (this.rooms.get(roomId) ?? null) : null;
  }

  private requirePlayer(room: InternalRoom, userId: string): Player {
    const player = room.players.get(userId);
    if (!player) throw forbidden('You are not a member of this room.');
    return player;
  }

  private transferOwnership(room: InternalRoom): void {
    const nextOwner = [...room.players.values()]
      .filter((player) => player.connected)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextOwner) {
      room.ownerId = nextOwner.userId;
      this.appendSystemMessage(room, `${nextOwner.username} is now the room owner.`);
    }
  }

  private scheduleCleanup(room: InternalRoom): void {
    this.cancelCleanup(room);
    room.cleanupTimer = setTimeout(() => {
      const current = this.rooms.get(room.id);
      if (current && ![...current.players.values()].some((player) => player.connected)) {
        void this.closeRoom(current, 'empty');
      }
    }, EMPTY_ROOM_TTL_MS);
    room.cleanupTimer.unref?.();
  }

  private cancelCleanup(room: InternalRoom): void {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }

  private cancelDrawerDisconnect(room: InternalRoom): void {
    if (room.drawerDisconnectTimer) clearTimeout(room.drawerDisconnectTimer);
    room.drawerDisconnectTimer = null;
  }

  private cancelOwnerTransfer(room: InternalRoom): void {
    if (room.ownerTransferTimer) clearTimeout(room.ownerTransferTimer);
    room.ownerTransferTimer = null;
  }

  private clearRoundTimers(room: InternalRoom): void {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    if (room.drawerDisconnectTimer) clearTimeout(room.drawerDisconnectTimer);
    room.roundTimer = null;
    room.nextRoundTimer = null;
    room.drawerDisconnectTimer = null;
    room.roundToken += 1;
  }

  private clearTimers(room: InternalRoom): void {
    this.clearRoundTimers(room);
    this.cancelCleanup(room);
    this.cancelOwnerTransfer(room);
  }

  private isRoomEmptyAndExpired(room: InternalRoom, now: number): boolean {
    return room.players.size === 0 || (![...room.players.values()].some((player) => player.connected) && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS);
  }

  private async closeRoom(room: InternalRoom, reason: 'empty' | 'stale' | 'no-players'): Promise<void> {
    if (!this.rooms.has(room.id)) return;
    this.clearTimers(room);
    this.rooms.delete(room.id);
    for (const player of room.players.values()) {
      if (this.userRooms.get(player.userId) === room.id) this.userRooms.delete(player.userId);
      if (player.socketId) {
        const socket = this.io?.sockets.sockets.get(player.socketId);
        socket?.leave(roomChannel(room.id));
        socket?.emit('system:message', {
          id: randomId(8),
          text: 'This room has closed.',
          createdAt: Date.now(),
        });
      }
    }
    try {
      await GameRoom.updateOne({ _id: room.dbId }, { $set: { status: 'closed', closedAt: new Date() } });
      if (room.sessionId) {
        await GameSession.updateOne(
          { _id: room.sessionId, status: 'active' },
          { $set: { status: 'abandoned', endedAt: new Date() } },
        );
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, 'Failed to close room records');
    }
    gameLog.info({ roomId: room.id, reason }, 'Room closed');
  }
}
