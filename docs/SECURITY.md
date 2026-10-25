# Security and threat model

This document describes the security controls in Cosmic Spider and the threats they do and do not address. It is intentionally specific about limits.

## 1. Assets

- Account credentials and password hashes.
- Session tokens and CSRF bindings.
- Password-reset tokens.
- Secret words during a live round.
- Room membership, scores, and game history.
- Moderation records and report reasons.
- Availability of the game process and database.

## 2. Trust boundaries

```text
Untrusted browser input
  -> Vite/Express origin, CORS, Helmet
  -> JSON schema validation and dangerous-key rejection
  -> session authentication and CSRF
  -> Socket.IO origin + session + event schemas
  -> GameHub authorization and game rules
  -> Mongoose models with typed fields
  -> MongoDB
```

The client is never trusted for scores, turn order, word correctness, timers, room ownership, or moderation authority.

## 3. Controls

### Account security

- **bcrypt cost 12** for passwords, with a maximum of 72 bytes.
- Password policy: 10-72 characters, at least one letter and one number.
- Username policy: 3-20 characters, letters/numbers/underscore, reserved names blocked.
- Unique lowercase username and email indexes.
- Generic login errors (`Invalid email or password`) for unknown accounts and wrong passwords.
- Dummy bcrypt work for unknown accounts to reduce timing differences.
- Five failed attempts lock the account for 15 minutes.
- Successful login clears failure counters.
- Password change requires the current password, rejects reuse, revokes all sessions, and issues a fresh one.
- Password reset tokens are 32 random bytes, stored as SHA-256 hashes, expire in 30 minutes, are single-use, and revoke all sessions.
- Recovery responses are identical for known and unknown emails, with a deliberate minimum response time.

### Sessions

- Opaque 32-byte random tokens, base64url encoded.
- Only the SHA-256 hash is stored in MongoDB.
- `cs_session` cookie is `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production.
- Session rotation on login and password change.
- Logout revokes the current session.
- Password reset and password change revoke all sessions for the user.
- TTL index removes expired sessions.
- Sessions are revalidated during socket activity.
- A single active socket per user; the newest connection wins.

### CSRF

- Synchronizer-token pattern: `cs_csrf` readable cookie plus `X-CSRF-Token` header.
- The header hash must match the session's stored CSRF hash using a constant-time comparison.
- Required for authenticated state-changing HTTP routes: logout, change password.
- Login, registration, forgot-password, and reset-password do not require CSRF because they either establish a session or are intentionally usable before authentication. They are protected by strict JSON content type, origin checks, rate limits, and same-site cookies.
- If the readable CSRF cookie is missing for a valid session, the server rotates the CSRF binding and sets a new cookie.
- Socket.IO actions rely on the authenticated cookie plus the exact origin allowlist; browsers do not allow arbitrary cross-origin WebSocket handshakes to carry a victim's cookies without the origin check failing.

### Browser hardening

Helmet sets:

- Content Security Policy: default/script/object/frame/form restrictions; `connect-src 'self' ws: wss:`; inline styles allowed for React style attributes; no inline scripts.
- `Strict-Transport-Security` in production, one year, include subdomains, preload.
- `X-Content-Type-Options: nosniff`.
- `X-Frame-Options: SAMEORIGIN` plus CSP `frame-ancestors 'none'` to prevent clickjacking.
- `Referrer-Policy: no-referrer`.
- `Permissions-Policy` disabling camera, microphone, geolocation, and payment.
- `Cross-Origin-Opener-Policy: same-origin`.
- `X-Powered-By` disabled.

CORS allows only exact origins from `ALLOWED_ORIGINS`, with credentials enabled. Socket.IO handshakes enforce the same allowlist.

### Input validation

- Strict Zod schemas reject unknown fields.
- `rejectDangerousInput` rejects keys named `__proto__`, `prototype`, or `constructor`, keys starting with `$`, and keys containing `.` in HTTP bodies and query strings.
- Body size is limited to 32 kB for `/api`.
- Socket payloads are validated per event.
- Drawing coordinates are finite and normalized to `0..1`.
- Stroke IDs must be UUIDs.
- Colours must match `#rrggbb`.
- Chat and guesses reject disallowed control characters.
- MongoDB operators are never built from raw user input.
- `sanitizeFilter` is deliberately **not** enabled globally. Mongoose's global option wraps trusted operators such as `$gt` and can break session expiry and login queries. Injection defence comes from strict schemas, dangerous-key rejection, and typed model fields instead.

### Rate limiting and abuse resistance

- Global API limit and route-specific limits (see [API.md](./API.md)).
- Socket global, per-user, and per-IP limits.
- Per-round guess attempt limit and cooldown.
- Chat cooldown and per-window limit.
- Drawing event, stroke, point, and payload limits.
- Registration, login, recovery, and reset limits.
- Report and moderation limits.
- Connection caps per IP and globally.

All counters are **in memory** and reset on restart. They are not a substitute for a WAF or a shared Redis limiter at scale.

### Secret handling

- The secret word is selected on the server.
- Only the active drawer receives the full word.
- Guessers receive a masked hint; at least two letters stay hidden.
- A player who has guessed does not receive the word in room state.
- Submitted guess text is stored server-side and projected as bullets until every connected eligible guesser has guessed; chat never carries guesses.
- Logs redact passwords, tokens, cookies, CSRF headers, and the `word` field.
- Error responses do not include stack traces or database errors.
- Mongoose duplicate-key errors are normalized to a generic `CONFLICT`.

### Data exposure

- `passwordHash`, `emailLower`, `usernameLower`, `failedLoginAttempts`, and `lockUntil` are `select: false`.
- Public room summaries expose only name, code, counts, settings, status, owner name, and update time.
- The global leaderboard exposes display name and aggregate statistics only.
- Reports and moderation records are never exposed through a public endpoint.
- API responses set `Cache-Control: no-store`.
- Static assets are cached immutably, but `index.html` is `no-cache`.

### Logging and operations

- Structured Pino logs with request IDs.
- Session cookies and CSRF headers are redacted.
- Security events (failed login, rejected origin, rate limit, moderation) are logged separately.
- Health and readiness endpoints support deployment probes.
- Graceful shutdown limits in-flight damage.
- Production configuration fails closed on insecure cookies, non-HTTPS origins, missing SMTP, or a non-HTTPS public URL.

## 4. Threat model

| Threat | Impact | Mitigation | Residual |
| --- | --- | --- | --- |
| Credential stuffing / brute force | Account takeover | bcrypt, generic errors, lockout, per-IP login limit, rate limits | Distributed low-and-slow attacks across IPs are not fully stopped; no MFA or breached-password check. |
| Session theft via XSS | Account takeover | CSP, React escaping, no `dangerouslySetInnerHTML`, `HttpOnly` cookie | Any future XSS or malicious dependency could still act as the user. |
| CSRF | Unauthorized state change | Synchronizer token, `SameSite=Lax`, origin checks, JSON requirement | Login CSRF is possible by design but does not grant access to an existing account. Same-site subdomain attackers are out of scope. |
| Session fixation | Account takeover | New session on login; session rotation; no session ID in URLs | None identified for the current flow. |
| Password reset abuse | Account takeover or spam | Hashed single-use tokens, 30-minute expiry, generic responses, rate limits, all sessions revoked | Email account compromise and reset-link interception remain outside the app's control. |
| User enumeration | Privacy / targeting | Generic login and recovery responses, dummy bcrypt work, constant recovery shape | Registration still reports that a username/email exists; this is a usability trade-off. |
| Room code guessing | Unauthorized join | Six characters from a 32-symbol alphabet, join rate limits, private rooms not listed | Codes are short enough to share verbally and are not secret against a determined online attacker; private rooms still rely on the code. |
| Cheating by guessing the word | Unfair play | Word only sent to drawer; masked hints; server validates guesses | Screen sharing, collusion, or a drawer communicating the word out of band cannot be detected. |
| Drawing DoS | Browser/server resource exhaustion | Event/point/stroke/payload limits, per-IP limits, canvas caps | A malicious drawer can still fill the allowed canvas and disrupt a round until cleared or ended. |
| Chat spam / abuse | Harassment | Rate limits, mute, kick, reports | Reports are not reviewed automatically; there is no profanity filter or image chat. |
| Socket hijacking / cross-origin | Unauthorized actions | Cookie auth, exact origin allowlist, session revalidation | A compromised browser or stolen cookie is equivalent to the user. |
| NoSQL injection | Data disclosure or corruption | Strict schemas, dangerous-key rejection, typed fields, no raw filters | New code that passes unvalidated query objects could reintroduce risk; review query construction. |
| IDOR | Unauthorized data access | Profile is derived from the session; room actions require membership; moderation requires ownership | Leaderboards and public room summaries are intentionally public to signed-in users. |
| XSS | Session theft / defacement | React escaping, CSP without inline scripts, no raw HTML rendering, control-character limits | Third-party scripts are not used, but supply-chain compromise remains possible. |
| Clickjacking | UI redress | CSP `frame-ancestors 'none'`, `X-Frame-Options: SAMEORIGIN` | None identified. |
| Dependency compromise | Broad compromise | Lockfile, `npm audit`, minimal dependencies, overrides | No automated SBOM or signature verification. |
| DDoS | Outage | Connection caps, rate limits, body limits, reverse-proxy guidance | In-process limits cannot absorb a volumetric attack; use a CDN/WAF and network protections. |
| Insider/operator access | Data exposure | Least-privilege database guidance, no admin UI, redacted logs | Operators with database access can read emails and moderation records. |
| Backup exposure | Data exposure | Deployment guidance | Backups are not encrypted by the application. |
| Horizontal-scaling inconsistency | Split rooms / wrong scores | Documented single-instance limit | Multi-replica deployment is unsupported without shared state and a Socket.IO adapter. |

## 5. Security invariants

These should remain true after changes:

1. The full secret word is never included in another player's room state or socket payload.
2. The drawer cannot submit a scoring guess.
3. A player can score at most once per round.
4. Points are computed only from the server clock.
5. Only the room owner can start, play again, or moderate.
6. Only the active drawer can draw.
7. A kicked user cannot rejoin that room.
8. Session tokens are never logged or stored in plaintext.
9. CSRF is required for authenticated state-changing HTTP routes.
10. Socket and HTTP origins are allowlisted in production.
11. A client cannot join a room it is not a member of and read its state.
12. The build must not ship `NODE_ENV=production` with insecure cookies or HTTP origins.

## 6. Reporting a vulnerability

Do not open a public issue with exploit details. Contact the maintainer privately with:

- Affected version or commit.
- Reproduction steps.
- Impact assessment.
- Whether the issue is already public.

There is no formal bug-bounty program.

## 7. What this project does not provide

- Email verification.
- MFA / WebAuthn.
- CAPTCHA.
- Admin moderation dashboard.
- Automated anti-cheat or collusion detection.
- Profanity or image moderation.
- WAF, CDN, or DDoS protection.
- Encrypted backups.
- Security certification or independent audit.
- Horizontal scalability.

See [RESIDUAL_RISKS.md](./RESIDUAL_RISKS.md) for operational consequences.
