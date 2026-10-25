# Residual risks and limitations

This is the honest list of what Cosmic Spider does **not** solve. Some items are deliberate scope choices; others are operational risks that must be managed by the deployer.

## High impact

### 1. Single-instance architecture

**Risk:** Rooms, rounds, timers, canvas strokes, chat history, mute state, and rate-limit counters live in one Node process. A restart ends every live game. Two replicas would create split rooms and inconsistent scores.

**Impact:** Downtime during deploys/crashes; no horizontal high availability.

**Current mitigation:** Graceful shutdown, readiness checks, documented single-instance limit.

**Required before scaling:** Shared room state, a Socket.IO adapter (for example Redis), distributed timer ownership, and a shared rate-limit store.

### 2. Score persistence is not transactional

**Risk:** `persistGuess()` upserts a `GameResult`, then increments `User.stats`, then marks `appliedToUser`. These are separate writes. A crash or database error between steps can leave:

- A result row with `appliedToUser: false` and missing user stats.
- User stats updated but `appliedToUser` still false (safe for score, confusing for reconciliation).
- An in-memory score that was never durably recorded if the write fails.

**Impact:** Leaderboard drift after failures.

**Current mitigation:** Unique `(sessionId, roundNumber, userId)` index prevents duplicate scoring; errors are logged; scoring awaits persistence before acknowledgement.

**Missing:** Automatic reconciliation job and MongoDB transactions. Add a periodic job that compares `gameresults` with `users.stats` and repairs gaps.

### 3. Account lockout can be abused

**Risk:** An attacker who knows an email can submit five bad passwords and lock the account for 15 minutes.

**Impact:** Targeted denial of service against a known user.

**Current mitigation:** Generic errors, rate limits, 15-minute lock.

**Missing:** Victim notification, progressive delays instead of hard lockout, MFA, or IP/device reputation.

### 4. No MFA or email verification

**Risk:** A stolen or guessed password is enough to take over an account. Email ownership is never proven.

**Impact:** Account takeover; password recovery depends entirely on email security.

**Current mitigation:** bcrypt cost 12, strong password policy, lockout, generic errors.

**Missing:** TOTP/WebAuthn, email verification, breached-password checks.

### 5. In-memory rate limits

**Risk:** Limits reset on restart and are not shared across processes. A botnet or distributed low-and-slow attack can evade per-IP limits.

**Impact:** Brute force, spam, resource exhaustion, registration abuse.

**Current mitigation:** Global, route, per-user, and per-IP limits; connection caps.

**Missing:** Redis-backed counters, WAF/CDN protection, CAPTCHA, IP reputation.

## Medium impact

### 6. No automated anti-cheat or collusion detection

**Risk:** Players can share the word over a call, screen-share, use alt accounts, or collaborate. A drawer can communicate the answer through drawing conventions.

**Impact:** Unfair games, leaderboard manipulation.

**Current mitigation:** Word only sent to the drawer; server-validated guesses; hints masked.

**Missing:** Behavioral analysis, device fingerprinting, report review workflow, ranked anti-cheat.

### 7. Room codes are shareable, not secret

**Risk:** Six-character codes are designed for verbal sharing. A determined attacker can attempt joins, subject to rate limits.

**Impact:** Unwanted guests in private rooms.

**Current mitigation:** 32-symbol alphabet, join rate limit, private rooms hidden from the public list, kick/ban per room.

**Missing:** Passwords on private rooms, invite expiry, per-room allowlists.

### 8. Moderation is minimal

**Risk:** The owner can mute, unmute, kick, and report. Reports are stored but not reviewed in-app. Kicks ban only for the current room's lifetime. Mutes are in-memory and expire after five minutes. A malicious owner can abuse kick/mute.

**Impact:** Harassment, griefing, unreliable moderation.

**Current mitigation:** Moderation audit records, rate limits, reports, room bans.

**Missing:** Admin dashboard, report queue, global bans, appeals, profanity/image filtering, owner accountability.

### 9. SMTP delivery is fire-and-forget

**Risk:** Reset emails are sent asynchronously without retries or a durable queue. If SMTP fails, the user sees the generic success message but receives nothing.

**Impact:** Password recovery failure; support burden.

**Current mitigation:** Errors are logged without credentials; development writes to `.mail-outbox/`.

**Missing:** Retry queue, bounce handling, delivery monitoring, provider webhooks.

### 10. Production configuration is operator-dependent

**Risk:** A misconfigured proxy, `TRUST_PROXY`, `ALLOWED_ORIGINS`, or cookie setting can weaken security or break login. The app fails closed on several production settings, but not on every proxy mistake.

**Impact:** Session/cookie failures, incorrect client IPs, origin bypass attempts, or lockouts.

**Current mitigation:** Startup validation, exact origin checks, secure-cookie requirement, deployment checklist.

**Missing:** Automated infrastructure tests and configuration drift detection.

### 11. Client bundle size

**Risk:** The initial shared client bundle is around 415 kB uncompressed (about 125 kB gzip), with page chunks loaded on demand.

**Impact:** Slower first load on poor networks.

**Current mitigation:** Route-level `React.lazy` code splitting, compression, immutable asset caching.

**Missing:** Formal performance budgets and long-term vendor chunk tuning. This is a performance issue, not a functional or security issue.

### 12. No browser E2E or accessibility audit

**Risk:** Component and Socket.IO tests do not prove the full UI works in real browsers, with screen readers, or on small devices.

**Impact:** Regressions in keyboard navigation, focus management, mobile layout, or browser quirks may ship.

**Current mitigation:** Component tests, manual browser verification, reduced-motion CSS, focus styles, ARIA labels, live regions.

**Missing:** Playwright/Cypress flows, axe scans, manual screen-reader testing, device matrix.

## Low impact / accepted trade-offs

### 13. Finite bundled word list

Words are selected from a local list. Repetition is possible across games. There is no category selection, difficulty rating, localization, or age rating. The list is not content-filtered beyond the authors' choice.

### 14. Account enumeration at registration

Login and recovery are generic, but registration reports that a username or email is already in use. This is a usability trade-off for a small game.

### 15. Login CSRF

Login and registration do not require a CSRF token. An attacker could log a victim into an attacker-controlled account ("login CSRF"). This does not expose the victim's existing account, but it can be confusing. Mitigated by same-site cookies and origin checks.

### 16. Origin checks are not authentication

Non-browser clients can set an `Origin` header. The origin allowlist protects browsers from cross-site abuse; it does not authenticate a custom client. The session cookie still does.

### 17. WebSocket connection caps are process-local

`MAX_CONNECTIONS` and per-IP caps protect one instance. A botnet can still exhaust them, and a corporate NAT can make legitimate users hit the per-IP cap. Tune per deployment.

### 18. Canvas abuse within limits

A drawer can fill the allowed canvas, draw noise, or stall a round. Limits cap points, strokes, events, and payload size, but do not judge content.

### 19. No data-retention automation

Sessions and reset tokens have TTL indexes. `GameSession`, `GameResult`, and `ModerationRecord` have no automatic retention. Operators must implement retention to satisfy privacy obligations.

### 20. Logs may contain personal data

Structured logs include IP addresses, user IDs, room IDs, and request paths. Cookies and credentials are redacted, but logs are still personal data. Set retention and access controls accordingly.

### 21. Backups are not encrypted by the app

Database and backup encryption are the operator's responsibility. Restoring old sessions can resurrect credentials; invalidate sessions after a restore.

### 22. Docker Compose uses a MongoDB root user in the example

The Compose example keeps setup simple by using the root user for initialization and the app connection. For real production, create a dedicated least-privilege user and update `MONGODB_URI`.

### 23. No automated dependency or supply-chain assurance

`npm audit` and a lockfile are used, but there is no SBOM, signature verification, or automated update bot. Same-origin scripts reduce third-party script risk, but a compromised dependency still executes on the server or in the browser.

### 24. No admin role UI

The `role` field exists (`user`/`admin`), but there is no admin API or UI. Any future admin surface must add authorization tests and audit logging.

### 25. Clock and timer edge cases

Round endings use server timestamps plus a 1-second ticker and a per-round timeout. A guess in the last millisecond can still be accepted or rejected based on processing order. Points are whole seconds, so sub-second races do not change the score, but the round-end boundary is not a distributed consensus clock.

### 26. Reconnect is browser/session-bound

A player can reconnect while the process lives and their membership is retained. A server restart loses the room. A user who clears cookies loses the session and cannot reclaim the seat.

### 27. No zero-downtime deployment

Restarting the process ends live games. There is no draining or handoff mechanism. Deploy during quiet periods or accept the interruption.

## Operational recommendations

1. Run one instance, monitor it, and restart quickly.
2. Add a reconciliation job for `GameResult.appliedToUser` and user stats.
3. Put a WAF/CDN and volumetric protection in front of the app.
4. Use a transactional email provider with delivery monitoring.
5. Add MFA and email verification before treating accounts as high-value.
6. Implement retention and access controls for logs, reports, and game history.
7. Add Playwright E2E tests and an accessibility audit before a major UI release.
8. Move to shared state, shared rate limits, and a Socket.IO adapter before adding replicas.
