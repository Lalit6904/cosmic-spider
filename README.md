# Cosmic Spider

A secure, real-time multiplayer drawing and guessing game. One player draws a secret word on a shared canvas; everyone else races to guess it before the round clock runs out.

Cosmic Spider is a complete full-stack application, not a simulated demo. The Express/Socket.IO server owns rooms, rounds, timers, hints, word secrets, guess validation, scoring, and leaderboards. The React client is a rendering and input layer.

## Highlights

- **Server-authoritative gameplay.** Round state, timers, secret words, hints, scoring, and winner determination all live on the server.
- **Real-time canvas.** Normalized stroke coordinates, synchronized live strokes, pen/eraser tools, colour picker, brush sizes, undo/redo, and clear.
- **Private and public rooms.** Six-character codes, configurable player limits, round length, and total rounds, plus host controls.
- **Secure accounts.** bcrypt (cost 12), opaque server-side sessions, hashed session tokens, CSRF synchronizer tokens, login lockout, and hashed single-use password-reset tokens.
- **Hardened HTTP and Socket.IO surfaces.** Exact origin allowlists, Helmet/CSP, strict Zod schemas, payload and rate limits, and structured error responses.
- **Reconnection support.** A dropped drawer gets a 10-second grace period; disconnected players keep their seat and can rejoin a live round.
- **Moderation.** Host mute/unmute/kick, permanent room bans for kicked players, and persisted player reports.
- **Cosmic responsive UI.** Mobile-friendly layout, accessible focus states, reduced-motion support, and live-region announcements for key game events.
- **Tested.** 50 automated tests across shared rules, HTTP security, Socket.IO gameplay, reconnection, race conditions, and React components.

## Technology

| Layer | Choice |
| --- | --- |
| Client | React 19, React Router 7, Vite 8, TypeScript |
| Server | Node.js 22+, Express 5, Socket.IO 4, TypeScript |
| Database | MongoDB 8 with Mongoose 9 |
| Auth | bcrypt, opaque cookie sessions, CSRF synchronizer token |
| Validation | Zod 4 |
| Tests | Vitest 5, Supertest, Socket.IO client, Testing Library, MongoDB Memory Server |
| Production | Single Node process serving the built SPA and API |

## Quick start

### Requirements

- Node.js 22 or newer (developed on Node 24)
- npm 10 or newer
- A reachable MongoDB instance (8.x recommended)

### Run locally

```powershell
cd cosmic-spider
npm install
Copy-Item .env.example .env
# Edit .env if your MongoDB URI is not mongodb://127.0.0.1:27017/cosmic_spider
npm run dev
```

Open <http://localhost:5173>. Vite proxies `/api` and `/socket.io` to the API on `127.0.0.1:3001`.

The development server binds the API to localhost. The database name defaults to `cosmic_spider`.

### Environment

Start from [`.env.example`](./.env.example). Key values:

| Variable | Purpose |
| --- | --- |
| `MONGODB_URI` | MongoDB connection string. Required. |
| `ALLOWED_ORIGINS` | Comma-separated exact browser origins for HTTP and WebSocket requests. |
| `PORT` / `HOST` | API listen address. Use `0.0.0.0` inside a container. |
| `SESSION_TTL_DAYS` | Session lifetime, 1-30 days. |
| `SECURE_COOKIES` | Must be `true` in production, behind HTTPS. |
| `TRUST_PROXY` | Set `true` only behind a trusted reverse proxy. |
| `SMTP_*` | Password-reset delivery. Required in production. |
| `APP_PUBLIC_URL` | Public HTTPS origin used in reset links. |

Production mode refuses to start unless origins are HTTPS, secure cookies are enabled, an HTTPS public URL is set, and SMTP is configured. This is intentional fail-closed behaviour.

## Production build

```powershell
npm ci
npm run build
$env:NODE_ENV="production"
npm start
```

`npm start` runs `dist/server/index.js`. The server serves the built SPA from `dist/client` and falls back to `index.html` for client routes. See [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) for Docker, Compose, and Nginx guidance.

> Cosmic Spider is designed as a **single Node instance**. Room state and rate-limit counters are in memory. Read [docs/RESIDUAL_RISKS.md](./docs/RESIDUAL_RISKS.md) before scaling horizontally.

## Scoring rule

A correct guess earns:

```text
Points Earned = Remaining Whole Seconds x 2
```

Remaining time is measured with the server clock when the guess is processed. `floor(remainingMs / 1000)` is used. A player can score at most once per round, the drawer cannot guess their own word, and no points are awarded for a stopped clock.

Guessing has its own channel and its own UI panel. Chat is chat-only. Each accepted guess appears as a masked entry (`•••••`), and the raw text is withheld from every client until all eligible guessers have guessed. See [docs/SOCKET_EVENTS.md](./docs/SOCKET_EVENTS.md#guessing).

In-room standings sort by score, then correct guesses, then join time, username, and user ID. The global leaderboard sorts by total points, wins, correct guesses, username, then ID.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Run API (watch mode) and Vite together. |
| `npm run dev:server` | Run only the API. |
| `npm run dev:client` | Run only the Vite client. |
| `npm run build` | Type-check, build the client, and bundle the server. |
| `npm start` | Start the production build. |
| `npm run typecheck` | TypeScript with no emit. |
| `npm run lint` | ESLint over the repository. |
| `npm test` | Server and client test suites. |
| `npm run test:server` | API, Socket.IO, and shared-rule tests. |
| `npm run test:client` | React component tests. |
| `npm run test:coverage` | Server coverage report. |
| `npm run audit` | High-severity dependency audit. |
| `npm run loadtest` | Opt-in Socket.IO load smoke test against a running server. |

## Project layout

```text
cosmic-spider/
  client/                 React application
    components/           Canvas, toolbar, timer, players, guesses, chat, modal
    context/              Auth and toast providers
    hooks/                Server-synchronized countdown
    lib/                  API and Socket.IO clients
    pages/                Landing, auth, lobby, profile, room, docs, 404
  server/
    config/               Environment validation
    db/                   MongoDB connection and readiness
    game/                 Authoritative GameHub and word list
    lib/                  Errors, crypto, logging
    middleware/           Auth, CSRF, origin, rate limits, validation helpers
    models/               Mongoose schemas
    routes/               HTTP API
    services/             Auth, sessions, profile, leaderboard, email
    socket/               Socket.IO authentication and event handlers
  shared/                 Protocol types and shared game rules
  tests/                  Server, client, and shared tests
  docs/                   Architecture, API, events, schema, security, deployment
  scripts/                Load-test tooling
```

## Documentation

- [Architecture](./docs/ARCHITECTURE.md)
- [HTTP API](./docs/API.md)
- [Socket events](./docs/SOCKET_EVENTS.md)
- [Database schema](./docs/DATABASE.md)
- [Security and threat model](./docs/SECURITY.md)
- [Testing](./docs/TESTING.md)
- [Deployment](./docs/DEPLOYMENT.md)
- [Residual risks](./docs/RESIDUAL_RISKS.md)

## Verification status

The following were run locally on Windows with Node 24 and MongoDB 8.2:

- `npm run typecheck` - passed
- `npm run lint` - passed with no warnings
- `npm test` - 50/50 tests passed
- `npm run build` - passed; route-level code splitting keeps every chunk under Vite's 500 kB warning threshold
- `npm run loadtest` - 6-player smoke passed with a correct guess and game-over; join/ready/guess acknowledgements stayed under 50 ms at p95
- `npm audit` - 0 vulnerabilities
- Manual two-client round - registration, room creation/join, ready-up, start, synchronized drawing, correct guess, +30 points, round end, and game-over standings all verified

There is no Playwright/Cypress browser suite in this repository. Client behaviour is covered by component tests and server behaviour by HTTP and Socket.IO integration tests; the end-to-end flow was verified manually during development.

## Fair play

Cosmic Spider is a casual party game. Reports and moderation actions are recorded, but there is no automated anti-cheat, image recognition, or collusion detection. See [docs/RESIDUAL_RISKS.md](./docs/RESIDUAL_RISKS.md) for the full honest list.
