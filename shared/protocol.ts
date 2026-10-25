/**
 * Shared, non-secret protocol contracts. Nothing in this file may contain the
 * secret-word list or authoritative scoring logic that clients rely on.
 */

export const ROOM_LIMITS = {
  minPlayers: 2,
  maxPlayers: 12,
  minRoundSeconds: 30,
  maxRoundSeconds: 180,
  minRounds: 1,
  maxRounds: 20,
} as const;

export const DRAWING_LIMITS = {
  maxEventsPerSecond: 45,
  maxPointsPerEvent: 64,
  maxCanvasPoints: 12_000,
  maxStrokes: 600,
  maxUndoDepth: 40,
  maxPayloadBytes: 96 * 1024,
} as const;

export const CHAT_LIMITS = {
  maxLength: 280,
  maxHistory: 100,
  messagesPerTenSeconds: 6,
  cooldownMs: 900,
} as const;

export const GUESS_LIMITS = {
  maxLength: 64,
  attemptsPerRound: 30,
  cooldownMs: 700,
} as const;

export type RoomVisibility = 'public' | 'private';
export type RoomPhase = 'lobby' | 'round' | 'roundEnd' | 'gameOver';

export interface PublicPlayer {
  id: string;
  username: string;
  score: number;
  correctGuesses: number;
  connected: boolean;
  ready: boolean;
  isOwner: boolean;
  guessedThisRound: boolean;
  mutedUntil: number | null;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
  correctGuesses: number;
  connected: boolean;
}

export interface ChatMessage {
  id: string;
  kind: 'player' | 'system';
  userId: string | null;
  username: string;
  text: string;
  createdAt: number;
}

export interface HintState {
  masked: string;
  revealedPositions: number[];
  length: number;
  lettersRemaining: number;
}

/**
 * A submitted guess as shown in the dedicated guess feed.
 * `text` stays null until every eligible guesser has guessed, so the raw
 * guess never leaks through room state, chat, or the feed while it matters.
 */
export interface MaskedGuess {
  id: string;
  roundNumber: number;
  userId: string;
  username: string;
  masked: string;
  text: string | null;
  correct: boolean;
  points: number;
  createdAt: number;
  revealed: boolean;
}

export interface MaskedGuessFeed {
  roundNumber: number;
  guesses: MaskedGuess[];
}

export interface RoundResultView {
  userId: string;
  username: string;
  points: number;
  correctGuesses: number;
}

export interface RoundSummary {
  roundNumber: number;
  drawerId: string;
  drawerName: string;
  word: string;
  reason: 'timeout' | 'allGuessed' | 'drawerLeft' | 'ownerEnded';
  results: RoundResultView[];
}

/** Backwards-friendly descriptive alias used by room/game internals. */
export type RoomSummary = RoundSummary;

export interface GameOverSummary {
  winnerId: string;
  winnerName: string;
  standings: LeaderboardEntry[];
}

export interface RoomState {
  id: string;
  code: string;
  name: string;
  visibility: RoomVisibility;
  ownerId: string;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
  phase: RoomPhase;
  roundNumber: number;
  currentDrawerId: string | null;
  currentDrawerName: string | null;
  roundEndsAt: number | null;
  serverNow: number;
  /** Only populated for the active drawer while a round is live. */
  word: string | null;
  /** Never contains the complete secret while the round is live. */
  hint: HintState | null;
  players: PublicPlayer[];
  leaderboard: LeaderboardEntry[];
  chat: ChatMessage[];
  /** Dedicated guess feed. Raw text is withheld until everyone has guessed. */
  maskedGuesses: MaskedGuess[];
  lastRound: RoundSummary | null;
  gameOver: GameOverSummary | null;
  canStart: boolean;
  strokes: DrawingStroke[];
  canDraw: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export interface DrawingPoint {
  x: number;
  y: number;
}

export interface DrawingStroke {
  id: string;
  color: string;
  width: number;
  tool: 'pen' | 'eraser';
  points: DrawingPoint[];
}

export interface PublicRoomSummary {
  code: string;
  name: string;
  playerCount: number;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
  status: 'waiting' | 'playing';
  ownerName: string;
  updatedAt: number;
}

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  stats: {
    gamesPlayed: number;
    wins: number;
    correctGuesses: number;
    totalPoints: number;
  };
  createdAt: string;
}

export interface ProfileGame {
  id: string;
  roomCode: string;
  startedAt: string;
  endedAt: string | null;
  playerScore: number;
  playerRank: number;
  winnerName: string | null;
  totalPlayers: number;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    requestId?: string;
  };
}

export interface AckSuccess<T = undefined> {
  ok: true;
  data?: T;
}

export interface AckFailure {
  ok: false;
  error: {
    code: string;
    message: string;
    retryAfterMs?: number;
  };
}

export type Ack<T = undefined> = AckSuccess<T> | AckFailure;

export interface GuessResult {
  correct: boolean;
  points?: number;
  message: string;
  alreadyGuessed?: boolean;
}

export interface RoundStartedPayload {
  roundNumber: number;
  drawerId: string;
  drawerName: string;
  endsAt: number;
  serverNow: number;
  word?: string;
  hint: HintState;
}

export type ClientEventMap = {
  'room:create': {
    name: string;
    visibility: RoomVisibility;
    maxPlayers: number;
    roundDurationSeconds: number;
    totalRounds: number;
  };
  'room:join': { code: string };
  'room:leave': Record<string, never>;
  'room:list': Record<string, never>;
  'game:ready': { ready: boolean };
  'game:start': Record<string, never>;
  'game:playAgain': Record<string, never>;
  'game:requestState': Record<string, never>;
  'drawing:stroke': {
    strokeId: string;
    color: string;
    width: number;
    tool: 'pen' | 'eraser';
    points: DrawingPoint[];
  };
  'drawing:end': { strokeId: string };
  'drawing:undo': Record<string, never>;
  'drawing:redo': Record<string, never>;
  'drawing:clear': Record<string, never>;
  'guess:submit': { text: string };
  'chat:send': { text: string };
  'moderation:action': {
    action: 'kick' | 'mute' | 'unmute';
    targetUserId: string;
  };
  'moderation:report': { targetUserId: string; reason: string };
};

export type ServerEventMap = {
  'room:state': RoomState;
  'room:list': PublicRoomSummary[];
  'room:playerJoined': { userId: string; username: string };
  'room:playerLeft': { userId: string; username: string; reason: string };
  'game:roundStarted': RoundStartedPayload;
  'game:timerUpdate': { roundNumber: number; endsAt: number; serverNow: number; remainingMs: number };
  'game:hint': HintState;
  'guess:result': GuessResult;
  /** Broadcast separately from chat; contains only masked text until reveal. */
  'guess:masked': MaskedGuessFeed;
  'game:roundEnded': RoundSummary;
  'score:updated': { leaderboard: LeaderboardEntry[] };
  'leaderboard:updated': { leaderboard: LeaderboardEntry[] };
  'game:over': GameOverSummary;
  'chat:message': ChatMessage;
  'system:message': { id: string; text: string; createdAt: number };
  'drawing:stroke': DrawingStroke;
  'drawing:sync': { strokes: DrawingStroke[] };
  'drawing:clear': Record<string, never>;
  error: { code: string; message: string; requestId?: string };
  'session:expired': { message: string };
};

export type ClientEventName = keyof ClientEventMap;
export type ServerEventName = keyof ServerEventMap;
