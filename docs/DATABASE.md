# Database schema

Database: MongoDB. Default name: `cosmic_spider`.

Mongoose models live in `server/models/`. Timestamps are enabled unless noted. `_id`, `createdAt`, and `updatedAt` are standard and omitted from the field tables where that is safe.

## Collections

### `users`

Account identity, password hash, and aggregate statistics.

| Field | Type | Notes |
| --- | --- | --- |
| `username` | string | Display form, max 20. |
| `usernameLower` | string | Unique index, lowercased, `select: false`. |
| `email` | string | Lowercased, max 254, `select: false`. |
| `emailLower` | string | Unique index, `select: false`. |
| `passwordHash` | string | bcrypt cost 12, `select: false`. |
| `role` | string | `user` or `admin`, default `user`. No admin UI is included. |
| `stats.gamesPlayed` | number | Non-negative. |
| `stats.wins` | number | Non-negative. |
| `stats.correctGuesses` | number | Non-negative. |
| `stats.totalPoints` | number | Non-negative. |
| `failedLoginAttempts` | number | `select: false`. |
| `lockUntil` | date or null | `select: false`. |

Indexes:

- Unique `usernameLower`.
- Unique `emailLower`.
- Compound `stats.totalPoints` desc, `stats.wins` desc, `stats.correctGuesses` desc, `usernameLower` asc for the global leaderboard.

`usernameLower`, `emailLower`, `passwordHash`, `failedLoginAttempts`, and `lockUntil` are never returned by normal queries unless explicitly selected.

### `sessions`

Opaque login sessions and their CSRF binding.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId ref User | Indexed. |
| `tokenHash` | string | SHA-256 hash of the cookie token; unique. The raw token is never stored. |
| `csrfHash` | string | SHA-256 hash of the CSRF token. |
| `expiresAt` | date | TTL index with `expireAfterSeconds: 0`. |
| `lastSeenAt` | date | Default now. |
| `userAgent` | string | Max 300, truncated. |

Indexes:

- Unique `tokenHash`.
- `userId`.
- TTL on `expiresAt` (MongoDB removes documents when the date passes).

The session cookie contains only the random opaque token.

### `passwordresettokens`

Single-use recovery tokens.

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | ObjectId ref User | Indexed. |
| `tokenHash` | string | Unique. Raw token is only in the emailed URL. |
| `expiresAt` | date | 30 minutes; TTL index. |
| `usedAt` | date or null | Set atomically when redeemed. |

Indexes:

- Unique `tokenHash`.
- `userId`.
- TTL on `expiresAt`.

### `gamerooms`

Durable room metadata. Live players, canvas, and timers are in memory.

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | Unique six-character code from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. |
| `name` | string | Max 40. |
| `ownerId` | ObjectId ref User | Indexed. |
| `visibility` | string | `public` or `private`. |
| `maxPlayers` | number | 2-12. |
| `roundDurationSeconds` | number | 30-180. |
| `totalRounds` | number | 1-20. |
| `status` | string | `open` or `closed`. Indexed. |
| `closedAt` | date or null | Set when the room closes. |

Indexes:

- Unique `code`.
- `ownerId`.
- `{ status: 1, updatedAt: -1 }`.
- TTL on `updatedAt` with a seven-day expiry. Closed rooms are retained briefly for auditing, then removed.

### `gamesessions`

One document per played game.

| Field | Type | Notes |
| --- | --- | --- |
| `roomId` | ObjectId ref GameRoom | Indexed. |
| `roomCode` | string | Max 8. |
| `players[]` | subdocument | `userId`, `username`, `score`, `correctGuesses`, `joinedAt`. |
| `roundsPlayed` | number | Non-negative. |
| `winnerId` | ObjectId ref User or null | |
| `winnerName` | string or null | |
| `status` | string | `active`, `finished`, or `abandoned`; indexed. |
| `startedAt` | date | |
| `endedAt` | date or null | |

Indexes:

- `roomId`.
- `status`.
- `{ 'players.userId': 1, createdAt: -1 }` for the profile's recent-games query.

### `gameresults`

One document per correct guess; the unique index is the final duplicate-scoring guard.

| Field | Type | Notes |
| --- | --- | --- |
| `sessionId` | ObjectId ref GameSession | Indexed. |
| `roomCode` | string | Max 8. |
| `roundNumber` | number | At least 1. |
| `userId` | ObjectId ref User | Indexed. |
| `username` | string | Snapshot at guess time. |
| `points` | number | Non-negative. |
| `remainingMs` | number | Non-negative. |
| `guessedAt` | date | |
| `appliedToUser` | boolean | True once user statistics were incremented. Indexed. |

Indexes:

- `sessionId`.
- `userId`.
- `appliedToUser`.
- **Unique** `{ sessionId, roundNumber, userId }`.

The result is inserted first and the user counters are incremented only when the upsert inserts a new document. `appliedToUser` supports future reconciliation. There is currently no automatic reconciliation job; see [RESIDUAL_RISKS.md](./RESIDUAL_RISKS.md).

### `moderationrecords`

| Field | Type | Notes |
| --- | --- | --- |
| `kind` | string | `report`, `mute`, `unmute`, `kick`; indexed. |
| `roomCode` | string | Max 8. |
| `actorId` | ObjectId ref User | Indexed. |
| `targetId` | ObjectId ref User | Indexed. |
| `reason` | string | Max 500. |
| `createdAt` | date | Indexed; `timestamps: false`. |

Indexes:

- `kind`.
- `actorId`.
- `targetId`.
- `createdAt` desc.

## In-memory room state

The following are intentionally not persisted per stroke or per timer tick:

- Players, scores, ready flags, seat order, connected state.
- Current drawer, secret word, revealed hint positions.
- Canvas strokes, point count, redo stack, active stroke.
- Chat history.
- Round deadline and timers.
- Room bans.
- Mute expiry.

Consequences:

- A server restart ends live games and rooms. Finished `GameSession` and `GameResult` records remain.
- Reconnecting a browser works while the process lives.
- Canvas state is not durable across process restarts.
- Horizontal scaling requires externalizing this state.

## Data lifecycle

| Data | Lifetime |
| --- | --- |
| Session | `SESSION_TTL_DAYS` (1-30), TTL index. |
| Password reset token | 30 minutes or single use. |
| Live room | In memory until empty/stale/closed, up to 6 hours. |
| `GameRoom` record | Seven days after last update, TTL index. |
| `GameSession` | Retained until manually pruned. |
| `GameResult` | Retained until manually pruned. |
| Moderation records | Retained until manually pruned. |

Recommended periodic maintenance:

- TTL indexes are not a backup policy. Back up MongoDB before any pruning.
- Add a retention job for sessions/results/moderation data according to your legal requirements.
- Monitor collection growth, especially `gameresults`, if the game is busy.

## Index creation

Mongoose creates declared indexes when models are first used, subject to `autoIndex`. For production, pre-create indexes during deployment:

```js
await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
```

The test setup calls `syncIndexes()` explicitly to guarantee the unique scoring index exists before race tests run.

## Queries and privacy

- `email`, `emailLower`, `usernameLower`, and `passwordHash` are excluded from normal projections.
- Public room listing is served from memory and never includes words or hints.
- Profile queries select only the current user.
- Leaderboards return aggregate stats only.
- Moderation records are not exposed by any public API.

## Backup and restore

- Use MongoDB Atlas backups or `mongodump`/`mongorestore`.
- Back up `users`, `gamesessions`, `gameresults`, and `moderationrecords` together for a consistent history.
- Sessions and reset tokens are short-lived; restoring them can resurrect old credentials. Prefer invalidating sessions after a restore.
- Test restores in a separate environment before relying on them.
