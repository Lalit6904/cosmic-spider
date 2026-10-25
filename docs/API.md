# HTTP API

Base path: `/api`. All request and response bodies are JSON unless noted. Authentication uses two cookies:

- `cs_session` - opaque session credential, `HttpOnly`, `SameSite=Lax`.
- `cs_csrf` - readable CSRF half, `SameSite=Lax`, bound to the session hash.

State-changing authenticated routes require the CSRF half in the `X-CSRF-Token` header. `GET` and `HEAD` requests do not.

## Conventions

### Success responses

JSON objects with endpoint-specific fields. `204 No Content` is used for logout.

### Error responses

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Please check the highlighted fields.",
    "fields": { "password": "Password must be at least 10 characters" },
    "requestId": "0f4c2f0e-9a5e-4b4e-8a7a-5f4a6b3c2d1e"
  }
}
```

`requestId` matches the `X-Request-Id` response header and server logs.

Common codes:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | Zod schema rejected the body; `fields` explains why. |
| 400 | `INVALID_INPUT` | Dangerous object keys (`$`, `.`, prototype keys) were present. |
| 400 | `JSON_REQUIRED` | Mutation did not use `Content-Type: application/json`. |
| 400 | `ORIGIN_REJECTED` | Request origin is not in `ALLOWED_ORIGINS`. |
| 401 | `UNAUTHENTICATED` | Missing, expired, or invalid session. |
| 401 | `INVALID_CREDENTIALS` | Login failed. Deliberately generic. |
| 403 | `FORBIDDEN` | Authenticated but not allowed. |
| 404 | `NOT_FOUND` | Unknown API route or resource. |
| 409 | `ACCOUNT_EXISTS`, `CONFLICT`, `ALREADY_IN_ROOM` | State conflict. |
| 429 | `RATE_LIMITED` | Rate limit exceeded. |
| 500 | `INTERNAL_ERROR` | Unexpected failure; details are not exposed. |
| 503 | health readiness only | Database not reachable. |

### CORS and credentials

- CORS allows only exact origins from `ALLOWED_ORIGINS`.
- `Access-Control-Allow-Credentials: true`.
- Allowed request headers: `Content-Type`, `X-CSRF-Token`.
- Exposed response headers: `X-Request-Id`, `RateLimit`, `RateLimit-Policy`.

### Caching

All `/api` responses set `Cache-Control: no-store`.

### Rate limits

Per-IP, in-memory, fixed windows. Exceeding a limit returns `429 RATE_LIMITED` with standard `RateLimit` headers.

| Scope | Limit |
| --- | --- |
| Global API | 600 requests / 15 min |
| Register | 8 / hour |
| Login | 15 / 15 min |
| Forgot password | 5 / 15 min |
| Reset password | 8 / 15 min |
| Change password | 10 / hour |
| Profile | 120 / 15 min |
| Leaderboard | 120 / 15 min |
| Public rooms | 120 / 15 min (shares the profile limiter) |

## Endpoints

### `GET /api/health`

Liveness. Does not touch the database.

```json
{ "status": "ok" }
```

### `GET /api/health/ready`

Readiness. Pings MongoDB.

- `200 { "status": "ready" }`
- `503 { "status": "unavailable" }`

### `GET /api/auth/session`

Returns the current session, user, and a usable CSRF token.

Authenticated:

```json
{
  "authenticated": true,
  "user": {
    "id": "665f1c2a9b1e4a0012a3b4c5",
    "username": "nova",
    "email": "nova@example.com",
    "stats": {
      "gamesPlayed": 4,
      "wins": 2,
      "correctGuesses": 11,
      "totalPoints": 420
    },
    "createdAt": "2026-05-01T12:00:00.000Z"
  },
  "csrfToken": "csrf-cookie-value"
}
```

Anonymous:

```json
{ "authenticated": false, "user": null, "csrfToken": null }
```

If the readable CSRF cookie is missing but the session is valid, the server rotates the CSRF binding and sets a new cookie.

### `POST /api/auth/register`

No CSRF required. Creates an account, starts a session, and returns the user plus CSRF token.

Request:

```json
{
  "username": "nova",
  "email": "nova@example.com",
  "password": "OrbitPass123"
}
```

Rules:

- Username: 3-20 characters, letters/numbers/underscore, not reserved.
- Email: valid, normalized to lowercase, unique.
- Password: 10-72 characters and at most 72 UTF-8 bytes, with at least one letter and one number.

Response `201`:

```json
{
  "user": { "id": "...", "username": "nova", "email": "nova@example.com", "stats": { "...": 0 }, "createdAt": "..." },
  "csrfToken": "..."
}
```

Errors: `VALIDATION_ERROR`, `ACCOUNT_EXISTS`, `RATE_LIMITED`.

### `POST /api/auth/login`

No CSRF required. Rotates the session on success.

Request:

```json
{ "email": "nova@example.com", "password": "OrbitPass123" }
```

Response `200`: same shape as registration.

Security behaviour:

- Unknown email and wrong password return the same `401 INVALID_CREDENTIALS`.
- Password hashing time is burned for unknown accounts.
- Five failed attempts lock the account for 15 minutes.
- A successful login clears failure counters and rotates the session.

### `POST /api/auth/logout`

Requires session and `X-CSRF-Token`. Revokes the current session, clears cookies, returns `204`.

### `POST /api/auth/forgot-password`

No CSRF required. Request:

```json
{ "email": "nova@example.com" }
```

Always responds `200` with the same message, whether or not the account exists. A 32-byte token is hashed and stored with a 30-minute expiry. In development, without SMTP, the reset link is written under `.mail-outbox/`.

```json
{ "message": "If an account exists for that email, a reset link has been sent." }
```

### `POST /api/auth/reset-password`

No CSRF required. Request:

```json
{ "token": "raw-token-from-email", "password": "NebulaPass456" }
```

The token is single-use and atomically marked used. On success all sessions for the user are revoked.

Response `200`:

```json
{ "message": "Your password has been reset. Sign in with your new password." }
```

Errors: `INVALID_RESET_TOKEN`, `VALIDATION_ERROR`.

### `POST /api/auth/change-password`

Requires session and `X-CSRF-Token`. Request:

```json
{ "currentPassword": "OrbitPass123", "newPassword": "NebulaPass456" }
```

On success, all sessions are revoked, a fresh session is created, cookies are replaced, and the response matches registration/login.

Errors: `CURRENT_PASSWORD_INVALID`, `PASSWORD_UNCHANGED`, `VALIDATION_ERROR`.

### `GET /api/profile`

Requires session. Returns the user and up to 10 finished games, newest first.

```json
{
  "user": { "...": "AuthUser" },
  "recentGames": [
    {
      "id": "665f...",
      "roomCode": "ABCDEF",
      "startedAt": "2026-05-01T12:00:00.000Z",
      "endedAt": "2026-05-01T12:04:00.000Z",
      "playerScore": 120,
      "playerRank": 1,
      "winnerName": "nova",
      "totalPlayers": 4
    }
  ]
}
```

### `GET /api/leaderboard`

Requires session. Returns the top 50 users globally.

```json
{
  "leaderboard": [
    { "rank": 1, "userId": "...", "username": "nova", "score": 420, "correctGuesses": 11, "connected": false }
  ]
}
```

Ordering: total points, wins, correct guesses, username, user ID.

### `GET /api/rooms/public`

Requires session. Returns public rooms currently held in memory.

```json
{
  "rooms": [
    {
      "code": "ABCDEF",
      "name": "The Drawing Nebula",
      "playerCount": 3,
      "maxPlayers": 8,
      "roundDurationSeconds": 80,
      "totalRounds": 3,
      "status": "waiting",
      "ownerName": "nova",
      "updatedAt": 1760000000000
    }
  ]
}
```

Private rooms are never listed. Secret words, hints, and player identities are not exposed here.

### Unknown API routes

Any unmatched `/api/*` returns:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Endpoint not found.",
    "requestId": "..."
  }
}
```

## Client example

```ts
const response = await fetch('/api/auth/login', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

const data = await response.json();
// Send data.csrfToken as X-CSRF-Token on logout/change-password.
```
