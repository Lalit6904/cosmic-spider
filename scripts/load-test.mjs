
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';

const BASE_URL = (process.env.LOADTEST_BASE_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const ORIGIN = process.env.LOADTEST_ORIGIN ?? 'http://localhost:5173';
const PLAYER_COUNT = Math.max(2, Math.min(12, Number(process.env.LOADTEST_PLAYERS ?? 6)));
const PASSWORD = 'OrbitPass123';
const ROUND_SECONDS = 30;
const TIMEOUT_MS = Number(process.env.LOADTEST_TIMEOUT_MS ?? 30_000);

if (!Number.isFinite(PLAYER_COUNT)) {
  console.error('LOADTEST_PLAYERS must be a number.');
  process.exit(1);
}

const parsedAccounts = process.env.LOADTEST_ACCOUNTS
  ? JSON.parse(process.env.LOADTEST_ACCOUNTS)
  : null;

if (parsedAccounts && (!Array.isArray(parsedAccounts) || parsedAccounts.length < 2)) {
  console.error('LOADTEST_ACCOUNTS must be a JSON array with at least two accounts.');
  process.exit(1);
}

if (!parsedAccounts && PLAYER_COUNT > 6) {
  console.error(
    'Refusing to auto-register more than 6 players: registration is limited to 8 per hour per IP. ' +
      'Set LOADTEST_PLAYERS<=6 or provide LOADTEST_ACCOUNTS.',
  );
  process.exit(1);
}

const accounts = parsedAccounts ?? null;
const count = accounts ? Math.min(accounts.length, PLAYER_COUNT) : PLAYER_COUNT;
const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

if (count < 2) {
  console.error('At least two players are required.');
  process.exit(1);
}

const samples = new Map();
function record(label, durationMs, ok = true) {
  if (!samples.has(label)) samples.set(label, []);
  samples.get(label).push({ durationMs, ok });
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

async function timed(label, fn) {
  const started = performance.now();
  try {
    const result = await fn();
    record(label, performance.now() - started, true);
    return result;
  } catch (error) {
    record(label, performance.now() - started, false);
    throw error;
  }
}

async function post(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }
  if (!response.ok) {
    const error = new Error(`${path} failed with ${response.status}: ${text.slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const cookie = setCookies.map((entry) => entry.split(';')[0]).join('; ');
  return { payload, cookie };
}

async function loginOrRegister(index) {
  if (accounts) {
    const account = accounts[index];
    return timed('login', async () => {
      const result = await post('/api/auth/login', {
        email: account.email,
        password: account.password ?? PASSWORD,
      });
      return { username: result.payload.user.username, cookie: result.cookie };
    });
  }
  const username = `load_${suffix}_${index}`;
  const email = `${username}@loadtest.local`;
  return timed('register', async () => {
    const result = await post('/api/auth/register', { username, email, password: PASSWORD });
    return { username: result.payload.user.username, cookie: result.cookie };
  });
}

function connect(cookie) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE_URL, {
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      timeout: 10_000,
      extraHeaders: { Cookie: cookie, Origin: ORIGIN },
    });
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('Socket connection timed out'));
    }, 10_000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error(`Socket connection failed: ${error.message}`));
    });
  });
}

function emitAck(socket, event, payload = {}, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    socket.timeout(timeoutMs).emit(event, payload, (error, response) => {
      if (error) {
        reject(new Error(`${event} acknowledgement timed out`));
        return;
      }
      if (!response?.ok) {
        reject(new Error(`${event} failed: ${response?.error?.code ?? 'unknown'} ${response?.error?.message ?? ''}`));
        return;
      }
      resolve(response.data);
    });
  });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);
    function handler(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(payload);
    }
    socket.on(event, handler);
  });
}

function drawRocket(socket) {
  const strokes = [
    [
      '#7ce7ff',
      8,
      [
        [0.5, 0.2],
        [0.42, 0.55],
        [0.5, 0.8],
        [0.58, 0.55],
        [0.5, 0.2],
      ],
    ],
    ['#a78bfa', 6, [[0.42, 0.55], [0.28, 0.7], [0.42, 0.66]]],
    ['#a78bfa', 6, [[0.58, 0.55], [0.72, 0.7], [0.58, 0.66]]],
    ['#ffd166', 5, [[0.47, 0.83], [0.5, 0.93], [0.53, 0.83]]],
  ];
  for (const [color, width, points] of strokes) {
    const strokeId = randomUUID();
    socket.emit(
      'drawing:stroke',
      {
        strokeId,
        color,
        width,
        tool: 'pen',
        points: points.map(([x, y]) => ({ x, y })),
      },
      () => {},
    );
    socket.emit('drawing:end', { strokeId }, () => {});
  }
}

const sockets = [];
let exitCode = 0;

try {
  console.log(`Cosmic Spider load smoke: ${count} players -> ${BASE_URL}`);

  const users = await Promise.all(Array.from({ length: count }, (_, index) => loginOrRegister(index)));
  console.log(`Authenticated ${users.length} players.`);

  for (const user of users) {
    const socket = await timed('connect', () => connect(user.cookie));
    socket.username = user.username;
    sockets.push(socket);
  }

  const owner = sockets[0];
  const created = await timed('room:create', () =>
    emitAck(owner, 'room:create', {
      name: `Load Test ${suffix}`.slice(0, 40),
      visibility: 'private',
      maxPlayers: count,
      roundDurationSeconds: ROUND_SECONDS,
      totalRounds: 1,
    }),
  );
  const code = created.code;
  console.log(`Room ${code} created.`);

  await Promise.all(
    sockets.map((socket) => timed('room:join', () => emitAck(socket, 'room:join', { code }))),
  );

  await Promise.all(
    sockets.map((socket) => timed('game:ready', () => emitAck(socket, 'game:ready', { ready: true }))),
  );

  const roundPromises = sockets.map((socket) => waitFor(socket, 'game:roundStarted'));
  await timed('game:start', () => emitAck(owner, 'game:start'));
  const roundPayloads = await Promise.all(roundPromises);

  const drawerIndex = roundPayloads.findIndex((payload) => typeof payload.word === 'string');
  if (drawerIndex < 0) throw new Error('No drawer received the secret word.');
  const drawer = sockets[drawerIndex];
  const word = roundPayloads[drawerIndex].word;
  console.log(`Round started. Drawer: ${drawer.username}. Secret length: ${word.length}.`);

  await timed('drawing', async () => {
    drawRocket(drawer);
    // Give the server a moment to process and broadcast the strokes.
    await new Promise((resolve) => setTimeout(resolve, 250));
  });

  const gameOverPromise = waitFor(sockets[0], 'game:over', () => true, 20_000);
  const guessers = sockets.filter((socket) => socket !== drawer);
  await Promise.all(
    guessers.map((socket) =>
      timed('guess:submit', async () => {
        const result = await emitAck(socket, 'guess:submit', { text: word });
        if (!result.correct) throw new Error(`Guess rejected for ${socket.username}`);
        return result;
      }),
    ),
  );

  const gameOver = await gameOverPromise;
  if (!gameOver?.winnerId) throw new Error('Game over payload was missing a winner.');

  const allOk = [...samples.values()].flat().every((sample) => sample.ok);
  if (!allOk) throw new Error('One or more timed operations failed.');

  const winnerScore = gameOver.standings?.find((player) => player.userId === gameOver.winnerId)?.score;
  console.log(`Game over. Winner: ${gameOver.winnerName} (${winnerScore ?? 'n/a'} points).`);
  console.log('\nAcknowledgement latency (ms):');
  console.log('operation      count    p50     p95     max');
  for (const [label, values] of samples) {
    const durations = values.map((value) => value.durationMs);
    console.log(
      `${label.padEnd(14)} ${String(durations.length).padEnd(7)} ${percentile(durations, 50)
        .toFixed(1)
        .padEnd(7)} ${percentile(durations, 95).toFixed(1).padEnd(7)} ${Math.max(...durations).toFixed(1)}`,
    );
  }
  console.log('\nLoad smoke passed. This is not a capacity benchmark.');
} catch (error) {
  exitCode = 1;
  console.error(`\nLoad smoke failed: ${error.message}`);
} finally {
  for (const socket of sockets.reverse()) {
    if (!socket.connected) continue;
    try {
      await emitAck(socket, 'room:leave', {}, 2_000);
    } catch {
      // Best effort.
    }
    socket.disconnect();
  }
  await new Promise((resolve) => setTimeout(resolve, 200));
  process.exit(exitCode);
}
