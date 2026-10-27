# Architecture

## 1. Shape of the system

Cosmic Spider is a single-origin JavaScript application using ES modules and JSX:

```text
Browser (React 19 + Vite)
  |  HTTPS: /api/*            (JSON)
  |  WSS:   /socket.io        (Socket.IO events)
  v
Node.js process (Express 5 + Socket.IO 4)
  |-- HTTP middleware: Helmet, CORS, origin guard, JSON limits, auth, CSRF, rate limits
  |-- HTTP routes: auth, profile, leaderboard, public rooms, health
  |-- RealtimeService: socket authentication, event schemas, rate limits, acknowledgements
  |-- GameHub: in-memory rooms, rounds, timers, hints, drawing, scoring, moderation
  |-- Services: accounts, sessions, profiles, leaderboards, email
  v
MongoDB 8 (Mongoose 9)
```

In development, Vite serves the client on port 5173 and proxies `/api` and `/socket.io` to the API on port 3001. In production, the same Express process serves `dist/client` and handles API and WebSocket traffic.

## 2. Why this architecture

- **Single authority.** Every rule that can affect fairness or another player runs on the server. The client can request actions, but cannot decide whether a guess is correct, how many points it earns, whose turn it is, or when a round ends.
- **Secret isolation.** The active drawer receives the secret word. Guessers receive only a masked hint. The full word is not present in a guesser's room state, a player who has already guessed does not get the word back, and raw guess text stays server-side until every eligible guesser has guessed.
- **Low-latency interaction.** Ephemeral room and canvas state stays in memory. MongoDB stores durable identity, room records, game sessions, per-guess results, and moderation records.
- **Simple deployment.** One process, one database, one origin. That keeps cookies, CSRF, CSP, and WebSocket origin checks straightforward.
- **Explicit limit.** Horizontal scaling is not supported without replacing in-memory room state and rate-limit stores. This is documented rather than hidden.

## 3. Server components

### `server/index.js`

Creates the database connection, `GameHub`, Express app, HTTP server, and `RealtimeService`; configures HTTP timeouts; and installs graceful shutdown for `SIGINT`/`SIGTERM`. Shutdown stops realtime work, closes the HTTP server, and disconnects Mongoose, with a 10-second forced-exit guard.

### `server/app.js`

Builds the Express middleware pipeline:

1. Request ID (`X-Request-Id`) and structured request logging.
2. Helmet, including CSP, HSTS in production, and no-referrer policy.
3. Permissions-Policy and Cross-Origin-Opener-Policy.
4. Compression.
5. CORS with an exact origin allowlist and credentials enabled.
6. Cookie parsing.
7. JSON body parsing limited to 32 kB for `/api`.
8. Origin guard and dangerous-key rejection.
9. Optional session authentication.
10. Global API rate limit and `Cache-Control: no-store`.
11. Health endpoints, API router, API 404 handler.
12. Static SPA serving and history fallback when `dist/client/index.html` exists.
13. Global 404 and structured error handler.

### `server/socket/RealtimeService.js`

Owns the Socket.IO server and per-connection lifecycle:

- Validates the `Origin` header against `ALLOWED_ORIGINS`.
- Authenticates the session cookie during the handshake and rejects unauthenticated sockets.
- Re-validates the session at most every 15 seconds during activity.
- Caps total connections and connections per IP.
- Enforces a single active socket per user; the newest connection wins and the old one is told why it was closed.
- Parses every event with a strict Zod schema.
- Applies per-user and per-IP event rate limits.
- Sends structured acknowledgements for every client action.
- Translates unexpected errors into safe socket error payloads.

### `server/game/GameHub.js`

The authoritative game engine. It owns:

- Room creation, joining, leaving, ownership transfer, and cleanup.
- Turn order and next-drawer selection.
- Round lifecycle, server timers, hint reveal schedule, and round-end transitions.
- Secret word selection and per-viewer room-state projection.
- Stroke authorization, validation, undo/redo, and broadcast.
- Guess normalization, cooldown, attempt limits, correctness, and scoring.
- Chat, mute, kick, report, and room bans.
- Persistence of sessions, per-guess results, user statistics, and moderation records.
- Play-again reset.

`GameHub` is deliberately independent of Express and Socket.IO internals so it can be tested directly. It receives a Socket.IO `Server` via `attach()` for broadcasting.

### `server/services/*`

- `authService.js`: registration, login, lockout, password change, password recovery, profile, global leaderboard.
- `sessions.js`: opaque session creation, cookie issuance, authentication, CSRF binding, rotation, and revocation.
- `email.js`: SMTP delivery, or a local `.mail-outbox/` file in development.

### `shared/*`

- `protocol.js`: client/server event names, room state, limits, and public view models.
- `game.js`: pure scoring, guess normalization, word masking, hint reveal, and deterministic ranking.

Nothing in `shared/` contains the secret word list or authoritative room state.

## 4. Room and round state machine

```text
lobby --start--> round --timeout/allGuessed/drawerLeft--> roundEnd --next round--> round
  ^                 |                                         |
  |                 +---------------- game over ---------------+
  +---------------- play again -------------------------------+
```

Phases:

| Phase | Meaning |
| --- | --- |
| `lobby` | Players can join, leave, ready up, and the owner can start when every connected player is ready and at least two are present. |
| `round` | One drawer, one secret word, a server deadline, active drawing, guessing, and hint reveals. |
| `roundEnd` | Results are shown for 6 seconds; the next round is scheduled if rounds remain. |
| `gameOver` | Final standings are shown. The owner can reset to the lobby with play-again. |

Room limits:

- 2-12 players.
- 30-180 seconds per round.
- 1-20 rounds.
- At most two active owned rooms per user.
- One room membership per user at a time.

## 5. Round sequence

```text
Owner            Server                           Drawer              Guesser
  | game:start      |                                |                    |
  |---------------->| validate owner/ready/players    |                    |
  |                 | choose drawer, pick word        |                    |
  |                 |<--- game:roundStarted (word) ---|                    |
  |                 |<--- game:roundStarted (hint) ---------------------->|
  |                 |<--- room:state, timer updates ---------------------->|
  |                 |                                | drawing:stroke     |
  |                 |<--------------------------------|                    |
  |                 |--- drawing:stroke (not echo) ---------------------->|
  |                 |<------------------------------------- guess:submit --|
  |                 | validate, normalize, score, persist                 |
  |                 |--- guess:result (private), guess:masked (room) ---->|
  |                 |--- score:updated, room:state ---------------------->|
  |                 | when all eligible guessed: reveal feed, finishRound |
  |                 |--- game:roundEnded, game:over (last round) -------->|
```

### Drawer selection

Turn order follows join order. The next drawer is the next connected player after the previous drawer. This avoids random gaps and makes rotations predictable.

### Secret and hints

`pickWord()` selects from a bundled list. The drawer's `game:roundStarted` payload includes `word`; other players receive only `hint`. The room-state projection also includes `word` only when the viewer is the active drawer during a live round.

Hints reveal one letter at roughly one-third of the round and three letters at roughly two-thirds. At least two letters always remain hidden by `revealHintPositions`. Revealed positions are sent as a masked string and position list.

Guesses do not use the chat path. `GameHub` records every accepted guess in a per-round feed and broadcasts `guess:masked` separately from `chat:message`. The feed projection contains only bullets and sets `text` to `null` until `allEligibleGuessed` is true. Chat therefore never shows guess submissions, guess results, or word notices, and raw guess text cannot appear in any client until the reveal condition is met.

### Timer authority

`roundEndsAt` is a server timestamp. The client synchronizes to `serverNow` and renders a countdown, but the server's 1-second ticker and a per-round timeout decide when the round actually ends. Late guesses are rejected.

### Scoring and persistence order

For a correct guess:

1. Verify phase, drawer, duplicate guess, attempt count, cooldown, and deadline.
2. Compute `floor(remainingMs / 1000) * 2`.
3. Update the in-memory score.
4. Await `persistGuess()`, which upserts a unique `GameResult` and increments user statistics exactly once.
5. Emit `score:updated` and room state.
6. If every eligible player has guessed, schedule `finishRound()` with `setImmediate`.

Awaiting persistence before acknowledgement prevents the next round or game-over transition from observing stale statistics. The unique `(sessionId, roundNumber, userId)` index is the final defence against duplicate scoring.

## 6. Drawing pipeline

- The client sends normalized points in the range 0-1, plus a UUID stroke ID and tool settings.
- Only the active drawer can draw.
- A stroke can be extended by the same drawer; a different player cannot extend it.
- Starting a new stroke implicitly ends the prior one.
- The server caps points per event (64), points per canvas (12,000), strokes (600), undo depth (40), and payload size.
- The server broadcasts accepted strokes to the room and deliberately does not echo them to the drawer, preventing duplicate rendering.
- Undo and redo mutate a server-side stack. New strokes clear the redo stack.
- The client renders from the server-provided stroke list on join/reconnect, so canvas state survives a refresh while the room lives.

## 7. Reconnection and cleanup

- A socket disconnect marks the player `connected = false` but keeps the seat and score.
- If the drawer disconnects during a round, a 10-second grace timer starts. Reconnecting the same user cancels it. If the timer fires, the round ends with reason `drawerLeft`.
- If the owner disconnects, ownership transfers after 30 seconds to the longest-seated connected player.
- Empty rooms are closed immediately on the last leave, or after 10 minutes if all players are disconnected.
- Rooms older than 6 hours, or with no players, are closed by the ticker.
- `GameRoom` records are TTL-expired from MongoDB seven days after their last update. Sessions and reset tokens have TTL indexes.

The client-side room page deliberately awaits the `room:leave` acknowledgement before disconnecting, preventing a fast navigation from being interpreted as a network drop and stranding membership.

## 8. Client architecture

- `AuthContext` restores `/api/auth/session`, stores the user, and exposes the CSRF token.
- `ApiClient` sends same-origin credentials and the `X-CSRF-Token` header for state-changing calls.
- `socket.js` creates one authenticated Socket.IO connection per room page, with automatic reconnect.
- `RoomPage` owns the room socket lifecycle, event subscriptions, state, and cleanup.
- `DrawingCanvas` renders committed strokes plus the local in-progress stroke, converts pointer coordinates to normalized values, and handles undo/redo/clear controls.
- `useServerCountdown` aligns a local animation frame loop to the server's `endsAt`/`serverNow`, avoiding drift and tab-throttle errors.
- `WordDisplay` only shows the full word to the active drawer; guessers see the masked hint.

## 9. Failure behaviour

- Database unavailable at startup: process exits with a fatal log.
- Readiness check fails: `/api/health/ready` returns 503.
- Session missing/expired: HTTP returns `401 UNAUTHENTICATED`; sockets receive `session:expired` and disconnect.
- Invalid or disallowed origin: HTTP returns `400 ORIGIN_REJECTED`; Socket.IO handshake is rejected.
- Rate limit exceeded: HTTP `429` or socket acknowledgement with `RATE_LIMITED`.
- Unexpected server error: structured `INTERNAL_ERROR` with a request ID; details stay in server logs.
- Persistence failure during scoring: the error is logged and the game continues; this can cause a durable stat gap and is listed as a residual risk.

## 10. Scaling boundary

The current design assumes exactly one application instance because:

- `GameHub` rooms and timers live in process memory.
- HTTP and socket rate limits use in-memory stores.
- Socket.IO broadcasts are local to the process.

Before running multiple replicas you must move room state to a shared store, use a shared rate-limit store, configure a Socket.IO adapter (for example Redis), and rework timer ownership with a distributed lock. See [RESIDUAL_RISKS.md](./RESIDUAL_RISKS.md).
