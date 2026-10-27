# Testing

## Commands

```powershell
npm test               # server + client
npm run test:server    # Vitest server/shared suites
npm run test:client    # Vitest React component suite
npm run test:coverage  # server coverage (v8)
npm run lint
npm run build
npm run audit
```

The repository currently has **50 passing tests**.

## Test environment

- Vitest with separate server and client configs.
- Server tests run in Node and use `supertest` and a real Socket.IO client.
- Client tests run in jsdom with Testing Library.
- `mongodb-memory-server` starts an isolated MongoDB instance for server tests.
- Server test files are run without file-level parallelism to keep shared in-memory rate-limit state deterministic.
- `tests/setup.server.js` connects through the production `connectDatabase()` helper so tests exercise the same Mongoose settings as the server.
- After each server test, collections are cleared and HTTP rate-limit stores are reset.
- The server test setup calls `syncIndexes()` so the unique scoring index exists before race tests.

On Windows, the setup prefers the installed MongoDB binary:

```text
C:\Program Files\MongoDB\Server\8.2\bin\mongod.exe
```

Override it with `MONGOMS_SYSTEM_BINARY` if MongoDB is installed elsewhere, or let `mongodb-memory-server` download a binary.

## Coverage map

### Shared rules - 11 tests

`tests/shared/game.test.js`

- Required scoring rule: remaining whole seconds multiplied by two.
- Zero/negative/NaN remaining time awards no points.
- Guess normalization for case, spacing, punctuation, and accents.
- Different words are not collapsed.
- Hint masking only reveals supplied positions.
- Spaces and punctuation remain visible.
- The final two letters are never revealed.
- Hint reveal is deterministic with an injected random source.
- Standings sort by score, correct guesses, join time, username, and ID.
- Leaderboard entries do not leak private player fields.

### HTTP authentication and security - 16 tests

`tests/server/auth.api.test.js`

- Registration hashes the password and sets an opaque `HttpOnly`, `SameSite=Lax` session cookie.
- Weak passwords, unknown fields, and duplicate accounts are rejected.
- Session restoration rotates CSRF when the readable cookie is missing.
- CSRF is enforced on state-changing authenticated routes.
- Login uses generic errors, rotates sessions, and locks out repeated failures.
- Password recovery returns the same response for known and unknown emails.
- Reset tokens work exactly once, revoke every session, and reject expired tokens.
- Profile data is only available to its owner.
- Public room listing excludes private rooms and secret state.
- Disallowed origins and dangerous object keys are rejected.
- Mutations require JSON.
- Hardening headers are present and the framework banner is hidden.
- Readiness returns 503 when MongoDB is unreachable.
- Recovery attempts are rate limited.
- Unknown API routes return a structured 404.

### Socket.IO and gameplay - 9 tests

`tests/server/realtime.test.js`

- Unauthenticated sockets and disallowed origins are rejected.
- Event payloads are validated and phase-invalid actions fail.
- A complete round runs with a server-only secret.
- The drawer alone receives the word.
- Non-drawers cannot draw; the drawer cannot guess.
- Correct guesses are scored, persisted, and reflected in user statistics.
- Guesses stay out of chat, broadcast as a separate masked feed, and reveal raw text only after every eligible guesser has guessed.
- Two simultaneous correct guesses produce exactly one accepted score.
- A disconnected drawer's seat and live round survive reconnection.
- Drawing bursts beyond the socket rate limit are rejected.
- Private rooms are hidden from the public directory.
- Mute, unmute, report, kick, and ban behaviour is covered.
- Strokes are broadcast to peers and not echoed to the drawer.

### Client components - 14 tests

`tests/client/components.test.jsx`

- `Modal` keeps focus in its autofocus field while the parent rerenders on every keystroke.
- `WordDisplay` shows the full word only to the active drawer.
- Guessers never see the secret, including after guessing.
- Stale words are hidden outside an active round.
- `TimerRing` formats time and marks the final ten seconds urgent.
- The timer exposes an accessible description.
- `DrawingToolbar` disables controls for spectators.
- The toolbar reports colour, size, tool, and history actions.
- `GuessPanel` renders masked entries without exposing submitted words.
- `GuessPanel` reveals raw guesses only when the server marks the feed revealed.
- `GuessPanel` trims and submits guesses, then clears the input on success.
- `ChatPanel` blocks muted players and trims messages.
- `AuthPage` validates registration fields before contacting the server.

### Manual end-to-end verification

During development, a full round was verified in a real browser plus a second authenticated Socket.IO client:

1. Register two users.
2. Create a public room with a 45-second round and 1 total round.
3. Join from both clients.
4. Ready both players and start as host.
5. Confirm the drawer sees the secret and the guesser sees only a mask.
6. Send valid drawing strokes from the drawer; confirm the guesser's canvas has painted pixels at the expected coordinates.
7. Submit the correct word from the guesser; confirm `+30 points` with 15 whole seconds remaining.
8. Confirm the round ends, the game-over standings show the winner, and MongoDB contains the result and updated statistics.

This manual check found and fixed a real configuration bug: global Mongoose `sanitizeFilter` was wrapping trusted operators and causing every authenticated HTTP request to return 500. Test setup now uses the production database helper so this class of regression is caught automatically.

## What is not covered

- No Playwright/Cypress browser automation.
- No visual regression or screenshot diffing.
- No accessibility audit with axe or a screen reader.
- No multi-instance/Redis tests because multi-instance deployment is unsupported.
- No long-duration soak test in CI.
- No SMTP integration test against a real provider; email delivery is mocked or written to `.mail-outbox/` in development.
- No load test in CI; `npm run loadtest` is opt-in.
- No test for every word in the word list.
- No fuzzing of the Socket.IO protocol beyond schema validation tests.

## Load test

Start a server (do not run this against production), then:

```powershell
$env:LOADTEST_BASE_URL = "http://127.0.0.1:3001"
$env:LOADTEST_ORIGIN = "http://localhost:5173"
$env:LOADTEST_PLAYERS = "6"
npm run loadtest
```

Registration is limited to 8 accounts per hour per IP, so the default is deliberately small. To test more players, pass pre-created accounts:

```powershell
$env:LOADTEST_ACCOUNTS = '[{"email":"a@example.com","password":"OrbitPass123"},{"email":"b@example.com","password":"OrbitPass123"}]'
npm run loadtest
```

The script reports join/ready/guess acknowledgement latency percentiles and fails if the round cannot be completed. It is a game-path smoke test, not a capacity benchmark.

## Suggested CI pipeline

```yaml
- npm ci
- npm run lint
- npm test
- npm run build
- npm run audit
```

`npm test` requires `mongodb-memory-server` to obtain a MongoDB binary, or `MONGOMS_SYSTEM_BINARY` to point at one. Cache the binary directory in CI to keep runs fast.

## Known test cautions

- Timing-sensitive tests use generous timeouts but can still be affected by an extremely slow machine.
- The drawing rate-limit test intentionally sends bursts; do not add real network latency to that suite without adjusting limits.
- Tests mutate process environment variables during setup. Run server and client configs separately as the npm scripts do.
- Database cleanup assumes the test database is dedicated to tests.
