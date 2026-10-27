# Socket.IO protocol

Namespace: default. Path: `/socket.io`. Transport: WebSocket or HTTP long-polling, with WebSocket preferred.

All event names and payloads are defined in [`shared/protocol.js`](../shared/protocol.js). This document describes the runtime contract.

## Connection

The socket handshake requires:

1. A valid `cs_session` cookie.
2. An `Origin` header that exactly matches an entry in `ALLOWED_ORIGINS`.

The server also enforces:

- `MAX_CONNECTIONS` total connections.
- `MAX_CONNECTIONS_PER_IP` per IP.
- One active socket per user. A newer connection disconnects the older one with a `session:expired` event: "This account connected from another browser tab."

Rejected handshakes fail with `UNAUTHENTICATED` or an origin error.

Sessions are re-checked during activity at most once every 15 seconds. If the session has been revoked or expired, the socket receives `session:expired` and is disconnected.

```js
import { io } from 'socket.io-client';

const socket = io('/', {
  withCredentials: true,
  transports: ['websocket', 'polling'],
});
```

## Acknowledgements

Client actions accept an optional acknowledgement callback. The shape is:

```text
type Ack<T> =
  | { ok: true; data?: T }
  | { ok: false; error: { code: string; message: string; retryAfterMs?: number } };
```

The server always replies to acknowledged events. Some failures also emit a separate `error` event for global handling.

## Client-to-server events

| Event | Payload | Who may call it | Ack data |
| --- | --- | --- | --- |
| `room:list` | `{}` | Any authenticated socket | `PublicRoomSummary[]` |
| `room:create` | `{ name, visibility, maxPlayers, roundDurationSeconds, totalRounds }` | Any authenticated socket | `{ code, roomId }` |
| `room:join` | `{ code }` | Any authenticated socket | `{ roomId, state }` |
| `room:leave` | `{}` | Room member | none |
| `game:ready` | `{ ready: boolean }` | Room member in lobby | none |
| `game:start` | `{}` | Room owner | none |
| `game:playAgain` | `{}` | Room owner after game over | none |
| `game:requestState` | `{}` | Room member | `RoomState` |
| `drawing:stroke` | `{ strokeId, color, width, tool, points }` | Active drawer | none |
| `drawing:end` | `{ strokeId }` | Active drawer | none |
| `drawing:undo` | `{}` | Active drawer | none |
| `drawing:redo` | `{}` | Active drawer | none |
| `drawing:clear` | `{}` | Active drawer | none |
| `guess:submit` | `{ text }` | Non-drawer in a live round | `GuessResult` |
| `chat:send` | `{ text }` | Room member, not muted | `ChatMessage` |
| `moderation:action` | `{ action: 'kick' \| 'mute' \| 'unmute', targetUserId }` | Room owner | none |
| `moderation:report` | `{ targetUserId, reason }` | Room member | none |

### Room creation and joining

Creating a room does not make the creator a player by itself; the client immediately joins with the returned code:

```js
const created = await emitAck('room:create', {
  name: 'The Drawing Nebula',
  visibility: 'public',
  maxPlayers: 8,
  roundDurationSeconds: 80,
  totalRounds: 3,
});

if (created.ok) {
  await emitAck('room:join', { code: created.data.code });
}
```

Room creation rules:

- Name: 3-40 characters.
- Visibility: `public` or `private`.
- Players: 2-12.
- Round length: 30-180 seconds.
- Rounds: 1-20.
- A user can be in only one room and can own at most two active rooms.

### Drawing

```js
socket.emit('drawing:stroke', {
  strokeId: crypto.randomUUID(),
  color: '#7ce7ff',
  width: 6,
  tool: 'pen', // or 'eraser'
  points: [
    { x: 0.42, y: 0.31 },
    { x: 0.44, y: 0.33 },
  ],
});
socket.emit('drawing:end', { strokeId });
```

Constraints:

- Coordinates are normalized to `0..1`.
- `strokeId` must be a UUID.
- Colour must be `#rrggbb`.
- Width: 1-40.
- At most 64 points per event, 12,000 points per canvas, 600 strokes, and 40 undo levels.
- Only the active drawer may draw.
- A different user cannot extend an existing stroke.
- The drawer's own stroke is not echoed back; peers receive `drawing:stroke`.
- Undo/redo broadcast a full `drawing:sync` snapshot.
- Clear broadcasts `drawing:clear`.

### Guessing

```js
socket.emit('guess:submit', { text: 'sweater' }, (ack) => {
  if (ack.ok) {
    console.log(ack.data.correct, ack.data.points);
  }
});
```

Rules:

- Max 64 characters, trimmed.
- 30 attempts per round.
- One guess per 700 ms (the server message says "one per second" for simplicity).
- A player who already guessed correctly cannot guess again in the same round.
- The drawer cannot guess.
- Only a live round accepts guesses.
- Correctness uses NFKC normalization, lowercase, diacritic removal, punctuation folding, and whitespace collapsing.
- Points are `floor(remainingMs / 1000) * 2`, using the server clock.

Guesses are deliberately separate from chat:

- `guess:submit` is the only way to guess; `chat:send` never accepts or scores a guess.
- Every accepted guess is appended to a server-owned per-round feed and broadcast as `guess:masked`.
- The feed contains only a bullet mask (`•••••`) until **every connected eligible guesser** has guessed.
- Raw guess text (`MaskedGuess.text`) is `null` before that point, so it cannot leak through room state, chat, or any event.
- The room chat contains no guess submissions, guess results, or guessed-word notices.
- When the final eligible guesser submits, the server marks the whole feed revealed and broadcasts it again before the round ends. On timeout, the feed stays masked and is cleared when the next round begins.

### Chat

Max 280 characters. Six messages per 10 seconds, plus a 900 ms cooldown. Muted players receive `FORBIDDEN`.

### Moderation

Only the room owner can mute, unmute, or kick. Mutes last 5 minutes and are in-memory. Kicks are recorded, ban the user from that room for its lifetime, and disconnect their socket. Any room member can file a report; reports are stored in MongoDB.

## Server-to-client events

| Event | Payload | When |
| --- | --- | --- |
| `room:state` | `RoomState` | After joins, leaves, readiness, round transitions, scores, hints, moderation, and state requests. |
| `room:list` | `PublicRoomSummary[]` | Response to `room:list`. |
| `room:playerJoined` | `{ userId, username }` | Another player joins. |
| `room:playerLeft` | `{ userId, username, reason }` | A player leaves, disconnects permanently, or is kicked. |
| `game:roundStarted` | `{ roundNumber, drawerId, drawerName, endsAt, serverNow, word?, hint }` | A round begins. `word` is present only for the drawer. |
| `game:timerUpdate` | `{ roundNumber, endsAt, serverNow, remainingMs }` | Roughly once per second during a round. |
| `game:hint` | `HintState` | A new hint stage is revealed. |
| `guess:result` | `{ correct, points?, message, alreadyGuessed? }` | Private feedback for the guessing player after a guess is processed. |
| `guess:masked` | `{ roundNumber, guesses: MaskedGuess[] }` | A guess was accepted. Entry text is masked until every eligible guesser has guessed. |
| `game:roundEnded` | `RoundSummary` | Round ends; includes the word and per-player results. |
| `score:updated` | `{ leaderboard }` | After a correct guess. |
| `leaderboard:updated` | `{ leaderboard }` | At round end. |
| `game:over` | `GameOverSummary` | Final round completed. |
| `chat:message` | `ChatMessage` | New player or system chat message. |
| `system:message` | `{ id, text, createdAt }` | System notice. |
| `drawing:stroke` | `DrawingStroke` | A peer's accepted stroke. Not sent to the drawer. |
| `drawing:sync` | `{ strokes }` | Full canvas after undo/redo or reconnect. |
| `drawing:clear` | `{}` | Canvas cleared. |
| `error` | `{ code, message, requestId? }` | Actionable failure, including `KICKED`. |
| `session:expired` | `{ message }` | Session revoked, expired, or replaced by a newer socket. |

### `RoomState`

`room:state` is projected per viewer. A room state has this shape:

```text
RoomState {
  id: string;
  code: string;
  name: string;
  visibility: 'public' | 'private';
  ownerId: string;
  maxPlayers: number;
  roundDurationSeconds: number;
  totalRounds: number;
  phase: 'lobby' | 'round' | 'roundEnd' | 'gameOver';
  roundNumber: number;
  currentDrawerId: string | null;
  currentDrawerName: string | null;
  roundEndsAt: number | null;
  serverNow: number;
  word: string | null;      // only the active drawer, only during a round
  hint: HintState | null;   // null for the drawer
  players: PublicPlayer[];
  leaderboard: LeaderboardEntry[];
  chat: ChatMessage[];
  maskedGuesses: MaskedGuess[]; // raw text withheld until the reveal condition
  lastRound: RoundSummary | null;
  gameOver: GameOverSummary | null;
  canStart: boolean;
  strokes: DrawingStroke[];
  canDraw: boolean;
  canUndo: boolean;
  canRedo: boolean;
}
```

`RoomState` never contains another player's session, email, or private statistics.

### Masked guess shape

```text
MaskedGuess {
  id: string;
  roundNumber: number;
  userId: string;
  username: string;
  masked: string;      // e.g. "•••••"
  text: string | null; // null until every eligible guesser has guessed
  correct: boolean;
  points: number;
  createdAt: number;
  revealed: boolean;
}
```

The feed is capped at the most recent 60 entries for the current round and is reset when a new round begins.

### Hint shape

```json
{
  "masked": "_ _ _ E _ _ _",
  "revealedPositions": [3],
  "length": 7,
  "lettersRemaining": 6
}
```

Hints reveal roughly one letter at one-third of the round and three letters at two-thirds, while always leaving at least two letters hidden.

## Socket rate limits

Per user unless noted. The global socket ceiling is 180 events / 10 seconds, plus 600 events / 10 seconds per IP.

| Event | Limit |
| --- | --- |
| `room:create` | 5 / 10 min |
| `room:join` | 12 / min |
| `room:list` | 30 / min |
| `room:leave` | 10 / min |
| `game:ready` | 30 / min |
| `game:start`, `game:playAgain` | 6 / min |
| `game:requestState` | 60 / min |
| `drawing:stroke` | 45 / second, plus 180 / second per IP |
| `drawing:end` | 30 / second |
| `drawing:undo`, `drawing:redo` | 8 / second |
| `drawing:clear` | 3 / 5 seconds |
| `guess:submit` | 4 / 2 seconds, 30 attempts per round |
| `chat:send` | 6 / 10 seconds |
| `moderation:action` | 15 / min |
| `moderation:report` | 3 / 10 min |

Exceeding a limit returns `429 RATE_LIMITED` through the acknowledgement and emits `error`.

## Error codes

Common socket error codes: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `NO_ACTIVE_ROUND`, `ALREADY_GUESSED`, `ROUND_ENDED`, `CANVAS_FULL`, `STROKE_IN_PROGRESS`, `STROKE_MISMATCH`, `NOTHING_TO_UNDO`, `NOTHING_TO_REDO`, `RATE_LIMITED`, `KICKED`, `INTERNAL_ERROR`.

## Reconnect example

```js
socket.on('disconnect', () => {
  // Socket.IO reconnects automatically.
});

socket.on('connect', () => {
  socket.emit('game:requestState', {}, (ack) => {
    if (ack.ok) renderRoom(ack.data);
  });
});
```

If the player is still a member, `game:requestState` returns the current room state, including the canvas snapshot. If the drawer disconnected, the server holds the round for 10 seconds before ending it with reason `drawerLeft`.
