import { createServer, type Server as HttpServer } from 'node:http';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../server/app';
import { GameHub } from '../../server/game/GameHub';
import { RealtimeService } from '../../server/socket/RealtimeService';
import { GameResult } from '../../server/models/GameResult';
import { GameSession } from '../../server/models/GameSession';
import { ModerationRecord } from '../../server/models/ModerationRecord';
import { User } from '../../server/models/User';
import type {
  Ack,
  GameOverSummary,
  MaskedGuessFeed,
  RoomState,
  RoundStartedPayload,
} from '../../shared/protocol';

const ORIGIN = 'http://localhost:5173';
const PASSWORD = 'OrbitPass123';

interface TestUser {
  id: string;
  username: string;
  cookie: string;
}

interface SocketUser {
  user: TestUser;
  socket: Socket;
}

let hub: GameHub;
let realtime: RealtimeService;
let httpServer: HttpServer;
let baseUrl: string;
let openSockets: Socket[];

beforeEach(async () => {
  hub = new GameHub();
  const app = createApp({ hub });
  httpServer = createServer(app);
  realtime = new RealtimeService(httpServer, hub);
  httpServer.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Test server did not bind a port');
  baseUrl = `http://127.0.0.1:${address.port}`;
  openSockets = [];
});

afterEach(async () => {
  for (const socket of openSockets) socket.disconnect();
  openSockets = [];
  hub.shutdown();
  await new Promise<void>((resolve) => {
    realtime.io.close(() => resolve());
  });
  if (httpServer.listening) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

async function registerUser(username: string): Promise<TestUser> {
  const app = createApp({ hub });
  const response = await request(app)
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .send({ username, email: `${username}@example.com`, password: PASSWORD });
  if (response.status !== 201) {
    throw new Error(`Registration failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  const cookies = response.headers['set-cookie'] as unknown as string[];
  const sessionCookie = cookies.find((cookie) => cookie.startsWith('cs_session='));
  if (!sessionCookie) throw new Error('Missing session cookie');
  return {
    id: response.body.user.id,
    username,
    cookie: sessionCookie.split(';')[0]!,
  };
}

async function connect(user: TestUser, origin = ORIGIN): Promise<Socket> {
  const socket = io(baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    reconnection: false,
    forceNew: true,
    extraHeaders: { Cookie: user.cookie, Origin: origin },
  });
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Socket connection timed out')), 5_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return socket;
}

function emitAck<T = unknown>(
  socket: Socket,
  event: string,
  payload: unknown = {},
  timeoutMs = 4_000,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    socket.timeout(timeoutMs).emit(event, payload, (error: Error | null, response: Ack<T>) => {
      if (error) {
        resolve({ ok: false, error: { code: 'TIMEOUT', message: error.message } });
        return;
      }
      resolve(response ?? { ok: false, error: { code: 'EMPTY_ACK', message: 'No response' } });
    });
  });
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean = () => true,
  timeoutMs = 6_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    const handler = (payload: T) => {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    };
    socket.on(event, handler);
  });
}

function onceSocket(socket: Socket, event: string, timeoutMs = 5_000): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (...args: unknown[]) => {
      clearTimeout(timer);
      resolve(args);
    });
  });
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createJoinedRoom(
  players: Array<{ user: TestUser; socket: Socket }>,
  options: Partial<{
    name: string;
    visibility: 'public' | 'private';
    maxPlayers: number;
    roundDurationSeconds: number;
    totalRounds: number;
  }> = {},
): Promise<string> {
  const [owner] = players;
  if (!owner) throw new Error('At least one player is required');
  const created = await emitAck<{ code: string; roomId: string }>(owner.socket, 'room:create', {
    name: options.name ?? 'Test Nebula',
    visibility: options.visibility ?? 'public',
    maxPlayers: options.maxPlayers ?? 8,
    roundDurationSeconds: options.roundDurationSeconds ?? 60,
    totalRounds: options.totalRounds ?? 1,
  });
  expect(created.ok).toBe(true);
  if (!created.ok || !created.data) throw new Error('Could not create room');
  const code = created.data.code;

  for (const player of players) {
    const joined = await emitAck<{ roomId: string; state: RoomState }>(player.socket, 'room:join', {
      code,
    });
    expect(joined.ok).toBe(true);
  }
  return code;
}

async function readyAndStart(players: Array<{ user: TestUser; socket: Socket }>): Promise<{
  roundPayloads: RoundStartedPayload[];
  drawer: SocketUser;
  guesser: SocketUser;
  word: string;
}> {
  for (const player of players) {
    const ready = await emitAck(player.socket, 'game:ready', { ready: true });
    expect(ready.ok).toBe(true);
  }

  const starts = players.map((player) =>
    waitForEvent<RoundStartedPayload>(player.socket, 'game:roundStarted'),
  );
  const start = await emitAck(players[0]!.socket, 'game:start');
  expect(start.ok).toBe(true);
  const roundPayloads = await Promise.all(starts);

  const drawerIndex = roundPayloads.findIndex((payload) => Boolean(payload.word));
  expect(drawerIndex).toBeGreaterThanOrEqual(0);
  const drawer = players[drawerIndex]!;
  const guesser = players[drawerIndex === 0 ? 1 : 0]!;
  const word = roundPayloads[drawerIndex]!.word!;
  return { roundPayloads, drawer, guesser, word };
}

describe('authenticated Socket.IO transport', () => {
  it('rejects connections without a session or from a disallowed origin', async () => {
    const noCookie = io(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Origin: ORIGIN },
    });
    openSockets.push(noCookie);
    const [noCookieError] = (await onceSocket(noCookie, 'connect_error')) as [Error];
    expect(noCookieError.message).toBe('UNAUTHENTICATED');

    const user = await registerUser('originuser');
    const handshake = await fetch(`${baseUrl}/socket.io/?EIO=4&transport=polling`, {
      headers: { Origin: 'https://evil.example' },
    });
    expect(handshake.status).toBe(400);

    const badOrigin = io(baseUrl, {
      path: '/socket.io',
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      extraHeaders: { Cookie: user.cookie, Origin: 'https://evil.example' },
    });
    openSockets.push(badOrigin);
    await expect(onceSocket(badOrigin, 'connect_error')).resolves.toBeDefined();
    expect(badOrigin.connected).toBe(false);
  });

  it('validates event payloads and rejects actions that are invalid for the phase', async () => {
    const owner = await registerUser('phaseowner');
    const ownerSocket = await connect(owner);
    await createJoinedRoom([{ user: owner, socket: ownerSocket }]);

    const invalid = await emitAck(ownerSocket, 'room:create', { name: 'x' });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe('VALIDATION_ERROR');

    const drawInLobby = await emitAck(ownerSocket, 'drawing:stroke', {
      strokeId: '00000000-0000-4000-8000-000000000000',
      color: '#ffffff',
      width: 4,
      tool: 'pen',
      points: [{ x: 0.1, y: 0.2 }],
    });
    expect(drawInLobby.ok).toBe(false);
    if (!drawInLobby.ok) expect(drawInLobby.error.code).toBe('NO_ACTIVE_ROUND');
  });
});

describe('authoritative game round', () => {
  it('runs a complete round with server-only secret, scoring and persistence', async () => {
    const alpha = await registerUser('alpha');
    const beta = await registerUser('beta');
    const players = [
      { user: alpha, socket: await connect(alpha) },
      { user: beta, socket: await connect(beta) },
    ];

    await createJoinedRoom(players);

    const notReady = await emitAck(players[1]!.socket, 'game:start');
    expect(notReady.ok).toBe(false);
    if (!notReady.ok) expect(notReady.error.code).toBe('FORBIDDEN');

    for (const player of players) {
      expect((await emitAck(player.socket, 'game:ready', { ready: true })).ok).toBe(true);
    }
    const notOwnerStart = await emitAck(players[1]!.socket, 'game:start');
    expect(notOwnerStart.ok).toBe(false);
    if (!notOwnerStart.ok) expect(notOwnerStart.error.code).toBe('FORBIDDEN');

    const starts = players.map((player) =>
      waitForEvent<RoundStartedPayload>(player.socket, 'game:roundStarted'),
    );
    const started = await emitAck(players[0]!.socket, 'game:start');
    expect(started.ok).toBe(true);
    const payloads = await Promise.all(starts);

    const drawerIndex = payloads.findIndex((payload) => Boolean(payload.word));
    expect(drawerIndex).toBeGreaterThanOrEqual(0);
    const drawer = players[drawerIndex]!;
    const guesser = players[drawerIndex === 0 ? 1 : 0]!;
    const secret = payloads[drawerIndex]!.word!;
    const guesserPayload = payloads[drawerIndex === 0 ? 1 : 0]!;
    expect(guesserPayload.word).toBeUndefined();
    expect(guesserPayload.hint.masked.replace(/\s/g, '')).not.toBe(secret.toUpperCase());
    expect(payloads[drawerIndex]!.hint.masked).toContain('_');

    // The drawer never receives points and cannot guess their own word.
    const drawerGuess = await emitAck(guesser.socket, 'game:requestState');
    expect(drawerGuess.ok).toBe(true);
    if (drawerGuess.ok) {
      const state = drawerGuess.data as RoomState;
      expect(state.word).toBeNull();
      expect(state.hint).not.toBeNull();
      expect(JSON.stringify(state)).not.toContain(secret);
    }

    const drawerStateResponse = await emitAck<RoomState>(drawer.socket, 'game:requestState');
    expect(drawerStateResponse.ok).toBe(true);
    if (drawerStateResponse.ok) {
      expect(drawerStateResponse.data?.word).toBe(secret);
    }

    const ownGuess = await emitAck(drawer.socket, 'guess:submit', { text: secret });
    expect(ownGuess.ok).toBe(false);
    if (!ownGuess.ok) expect(ownGuess.error.code).toBe('FORBIDDEN');

    // Only the active drawer may paint.
    const outsiderDraw = await emitAck(guesser.socket, 'drawing:stroke', {
      strokeId: '11111111-1111-4111-8111-111111111111',
      color: '#ffffff',
      width: 4,
      tool: 'pen',
      points: [{ x: 0.2, y: 0.2 }],
    });
    expect(outsiderDraw.ok).toBe(false);
    if (!outsiderDraw.ok) expect(outsiderDraw.error.code).toBe('FORBIDDEN');

    const drawerDraw = await emitAck(drawer.socket, 'drawing:stroke', {
      strokeId: '22222222-2222-4222-8222-222222222222',
      color: '#ffffff',
      width: 4,
      tool: 'pen',
      points: [
        { x: 0.1, y: 0.1 },
        { x: 0.2, y: 0.2 },
      ],
    });
    expect(drawerDraw.ok).toBe(true);

    const wrong = await emitAck<{ correct: boolean }>(guesser.socket, 'guess:submit', {
      text: 'definitely-not-the-word',
    });
    expect(wrong.ok).toBe(true);
    if (wrong.ok) expect(wrong.data?.correct).toBe(false);

    // The guessing cooldown is server-authoritative.
    await wait(760);

    const gameOver = waitForEvent<GameOverSummary>(guesser.socket, 'game:over');
    const [first, second] = await Promise.all([
      emitAck<{ correct: boolean; points: number }>(guesser.socket, 'guess:submit', { text: secret }),
      emitAck<{ correct: boolean; points: number }>(guesser.socket, 'guess:submit', {
        text: secret.toUpperCase(),
      }),
    ]);
    const correctAcks = [first, second].filter((ack) => ack.ok && ack.data?.correct);
    expect(correctAcks).toHaveLength(1);
    const accepted = correctAcks[0]!;
    if (!accepted.ok) throw new Error('Expected a successful guess');
    const points = accepted.data!.points;
    expect(points).toBeGreaterThan(0);
    expect(points % 2).toBe(0);
    expect(points).toBeLessThanOrEqual(118);

    const summary = await gameOver;
    expect(summary.winnerId).toBe(guesser.user.id);
    expect(summary.standings[0]?.score).toBe(points);

    expect(await GameResult.countDocuments({})).toBe(1);
    const result = await GameResult.findOne({});
    expect(result?.points).toBe(points);
    expect(result?.appliedToUser).toBe(true);

    const session = await GameSession.findOne({});
    expect(session?.status).toBe('finished');
    expect(session?.winnerName).toBe(guesser.user.username);

    const winner = await User.findById(guesser.user.id).lean();
    expect(winner?.stats.totalPoints).toBe(points);
    expect(winner?.stats.correctGuesses).toBe(1);
    expect(winner?.stats.wins).toBe(1);
    expect(winner?.stats.gamesPlayed).toBe(1);

    const drawerRecord = await User.findById(drawer.user.id).lean();
    expect(drawerRecord?.stats.gamesPlayed).toBe(1);
    expect(drawerRecord?.stats.totalPoints).toBe(0);
    expect(drawerRecord?.stats.wins).toBe(0);
  }, 30_000);

  it('keeps guesses out of chat and masks them until every guesser has guessed', async () => {
    const alpha = await registerUser('maskalpha');
    const beta = await registerUser('maskbeta');
    const gamma = await registerUser('maskgamma');
    const players = [
      { user: alpha, socket: await connect(alpha) },
      { user: beta, socket: await connect(beta) },
      { user: gamma, socket: await connect(gamma) },
    ];
    await createJoinedRoom(players);
    const { drawer, guesser, word } = await readyAndStart(players);
    const otherGuesser = players.find(
      (player) => player.user.id !== drawer.user.id && player.user.id !== guesser.user.id,
    )!;
    const wrongText = 'definitely-not-the-word';

    const wrongFeedPromise = waitForEvent<MaskedGuessFeed>(otherGuesser.socket, 'guess:masked');
    const wrong = await emitAck<{ correct: boolean }>(guesser.socket, 'guess:submit', {
      text: wrongText,
    });
    expect(wrong.ok).toBe(true);
    if (wrong.ok) expect(wrong.data?.correct).toBe(false);

    const wrongFeed = await wrongFeedPromise;
    const wrongEntry = wrongFeed.guesses.find((entry) => entry.userId === guesser.user.id)!;
    expect(wrongEntry.text).toBeNull();
    expect(wrongEntry.revealed).toBe(false);
    expect(wrongEntry.masked).toMatch(/^•+$/);
    expect(JSON.stringify(wrongEntry)).not.toContain(wrongText);

    // Chat stays chat-only: neither the guess nor a "guessed the word" notice.
    const state = await emitAck<RoomState>(otherGuesser.socket, 'game:requestState');
    expect(state.ok).toBe(true);
    if (state.ok) {
      const chat = JSON.stringify(state.data!.chat);
      expect(chat).not.toContain(wrongText);
      expect(chat).not.toContain('guessed the word');
      expect(state.data!.maskedGuesses.find((entry) => entry.userId === guesser.user.id)?.text).toBeNull();
    }

    await wait(760);
    const hiddenCorrectFeedPromise = waitForEvent<MaskedGuessFeed>(
      otherGuesser.socket,
      'guess:masked',
      (feed) => feed.guesses.some((entry) => entry.correct),
    );
    const correct = await emitAck<{ correct: boolean }>(guesser.socket, 'guess:submit', {
      text: word,
    });
    expect(correct.ok).toBe(true);
    if (correct.ok) expect(correct.data?.correct).toBe(true);

    const hiddenCorrectFeed = await hiddenCorrectFeedPromise;
    const hiddenCorrect = hiddenCorrectFeed.guesses.find((entry) => entry.correct)!;
    expect(hiddenCorrect.text).toBeNull();
    expect(hiddenCorrect.revealed).toBe(false);
    expect(hiddenCorrect.masked).toMatch(/^•+$/);
    expect(JSON.stringify(hiddenCorrect)).not.toContain(word);

    await wait(760);
    const revealFeedPromise = waitForEvent<MaskedGuessFeed>(
      otherGuesser.socket,
      'guess:masked',
      (feed) => feed.guesses.some((entry) => entry.revealed && entry.text === word),
    );
    const finalGuess = await emitAck<{ correct: boolean }>(otherGuesser.socket, 'guess:submit', {
      text: word,
    });
    expect(finalGuess.ok).toBe(true);
    if (finalGuess.ok) expect(finalGuess.data?.correct).toBe(true);

    const revealFeed = await revealFeedPromise;
    expect(revealFeed.guesses.filter((entry) => entry.revealed).length).toBeGreaterThanOrEqual(3);
    expect(
      revealFeed.guesses.find((entry) => entry.userId === guesser.user.id && entry.correct)?.text,
    ).toBe(word);
    expect(
      revealFeed.guesses.find((entry) => entry.userId === otherGuesser.user.id && entry.correct)?.text,
    ).toBe(word);
    // Even the earlier wrong guess is revealed only after everyone guessed.
    expect(
      revealFeed.guesses.find((entry) => entry.userId === guesser.user.id && !entry.correct)?.text,
    ).toBe(wrongText);
  }, 30_000);

  it('holds a disconnected drawer seat and preserves the live round on reconnect', async () => {
    const alpha = await registerUser('reconnectalpha');
    const beta = await registerUser('reconnectbeta');
    const alphaSocket = await connect(alpha);
    const betaSocket = await connect(beta);
    await createJoinedRoom([
      { user: alpha, socket: alphaSocket },
      { user: beta, socket: betaSocket },
    ]);
    const { word } = await readyAndStart([
      { user: alpha, socket: alphaSocket },
      { user: beta, socket: betaSocket },
    ]);

    const offlineState = waitForEvent<RoomState>(
      betaSocket,
      'room:state',
      (state) => state.players.some((player) => player.id === alpha.id && !player.connected),
    );
    alphaSocket.disconnect();
    const stateAfterDisconnect = await offlineState;
    expect(stateAfterDisconnect.phase).toBe('round');

    const secondAlphaSocket = await connect(alpha);
    const rejoin = await emitAck<{ state: RoomState }>(secondAlphaSocket, 'room:join', {
      code: stateAfterDisconnect.code,
    });
    expect(rejoin.ok).toBe(true);
    if (rejoin.ok) {
      const state = rejoin.data!.state;
      expect(state.phase).toBe('round');
      expect(state.currentDrawerId).toBe(alpha.id);
      expect(state.word).toBe(word);
      expect(state.players.find((player) => player.id === alpha.id)?.connected).toBe(true);
    }
  }, 20_000);

  it('rejects drawing bursts beyond the socket rate limit', async () => {
    const alpha = await registerUser('ratealpha');
    const beta = await registerUser('ratebeta');
    const players = [
      { user: alpha, socket: await connect(alpha) },
      { user: beta, socket: await connect(beta) },
    ];
    await createJoinedRoom(players);
    const { drawer } = await readyAndStart(players);

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        emitAck(drawer.socket, 'drawing:stroke', {
          strokeId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
          color: '#ffffff',
          width: 3,
          tool: 'pen',
          points: [{ x: 0.5, y: 0.5 }],
        }),
      ),
    );
    const limited = results.filter((response) => !response.ok && response.error.code === 'RATE_LIMITED');
    expect(limited.length).toBeGreaterThan(0);
    expect(results.some((response) => response.ok)).toBe(true);
  }, 20_000);
});

describe('room privacy and moderation', () => {
  it('hides private rooms from the public directory', async () => {
    const alpha = await registerUser('publicalpha');
    const beta = await registerUser('privatebeta');
    const alphaSocket = await connect(alpha);
    const betaSocket = await connect(beta);

    const publicCode = await createJoinedRoom(
      [{ user: alpha, socket: alphaSocket }],
      { name: 'Open Cluster', visibility: 'public' },
    );
    const privateCode = await createJoinedRoom(
      [{ user: beta, socket: betaSocket }],
      { name: 'Secret Cluster', visibility: 'private' },
    );

    const listed = await emitAck<Array<{ code: string; name: string }>>(alphaSocket, 'room:list');
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const codes = listed.data!.map((room) => room.code);
      expect(codes).toContain(publicCode);
      expect(codes).not.toContain(privateCode);
      expect(JSON.stringify(listed.data)).not.toContain('secretWord');
    }
  });

  it('mutes, unmutes, records reports, kicks and bans a player', async () => {
    const alpha = await registerUser('owneralpha');
    const beta = await registerUser('targetbeta');
    const alphaSocket = await connect(alpha);
    const betaSocket = await connect(beta);
    const roomCode = await createJoinedRoom([
      { user: alpha, socket: alphaSocket },
      { user: beta, socket: betaSocket },
    ]);

    const mutedState = waitForEvent<RoomState>(
      betaSocket,
      'room:state',
      (state) => state.players.find((player) => player.id === beta.id)?.mutedUntil != null,
    );
    const mute = await emitAck(alphaSocket, 'moderation:action', {
      action: 'mute',
      targetUserId: beta.id,
    });
    expect(mute.ok).toBe(true);
    await mutedState;

    const mutedChat = await emitAck(betaSocket, 'chat:send', { text: 'Can anyone hear me?' });
    expect(mutedChat.ok).toBe(false);
    if (!mutedChat.ok) expect(mutedChat.error.code).toBe('FORBIDDEN');

    const unmute = await emitAck(alphaSocket, 'moderation:action', {
      action: 'unmute',
      targetUserId: beta.id,
    });
    expect(unmute.ok).toBe(true);
    const chat = await emitAck(betaSocket, 'chat:send', { text: 'Back online.' });
    expect(chat.ok).toBe(true);

    const report = await emitAck(betaSocket, 'moderation:report', {
      targetUserId: alpha.id,
      reason: 'Testing the reporting pipeline.',
    });
    expect(report.ok).toBe(true);
    expect(await ModerationRecord.countDocuments({ kind: 'report' })).toBe(1);

    const kicked = waitForEvent<{ code: string }>(betaSocket, 'error', (payload) => payload.code === 'KICKED');
    const removedState = waitForEvent<RoomState>(
      alphaSocket,
      'room:state',
      (state) => !state.players.some((player) => player.id === beta.id),
    );
    const kick = await emitAck(alphaSocket, 'moderation:action', {
      action: 'kick',
      targetUserId: beta.id,
    });
    expect(kick.ok).toBe(true);
    await kicked;
    await removedState;

    expect(await ModerationRecord.countDocuments({ kind: 'kick' })).toBe(1);

    const retry = await connect(beta);
    const banned = await emitAck(retry, 'room:join', { code: roomCode });
    expect(banned.ok).toBe(false);
    if (!banned.ok) expect(banned.error.code).toBe('FORBIDDEN');
  }, 20_000);
});

describe('drawing synchronisation', () => {
  it('broadcasts strokes to peers but never echoes them to the drawer', async () => {
    const alpha = await registerUser('drawalpha');
    const beta = await registerUser('drawbeta');
    const players = [
      { user: alpha, socket: await connect(alpha) },
      { user: beta, socket: await connect(beta) },
    ];
    await createJoinedRoom(players);
    const { drawer, guesser } = await readyAndStart(players);

    const received = waitForEvent<{ id: string; points: Array<{ x: number; y: number }> }>(
      guesser.socket,
      'drawing:stroke',
    );
    const echoed = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 400);
      drawer.socket.once('drawing:stroke', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });

    const strokeId = '33333333-3333-4333-8333-333333333333';
    const ack = await emitAck(drawer.socket, 'drawing:stroke', {
      strokeId,
      color: '#4cc9f0',
      width: 6,
      tool: 'pen',
      points: [
        { x: 0.05, y: 0.05 },
        { x: 0.4, y: 0.4 },
      ],
    });
    expect(ack.ok).toBe(true);
    const segment = await received;
    expect(segment.id).toBe(strokeId);
    expect(segment.points).toHaveLength(2);
    expect(await echoed).toBe(false);

    const sync = waitForEvent<{ strokes: Array<{ id: string }> }>(guesser.socket, 'drawing:sync');
    expect((await emitAck(drawer.socket, 'drawing:undo')).ok).toBe(true);
    const synced = await sync;
    expect(synced.strokes).toHaveLength(0);
  }, 20_000);
});
