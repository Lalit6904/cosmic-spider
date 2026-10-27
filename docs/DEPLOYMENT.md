# Deployment

Cosmic Spider is a single Node.js process plus MongoDB. It serves the built React SPA, the HTTP API, and Socket.IO from the same origin. Production is expected to sit behind a TLS-terminating reverse proxy.

## 1. Production checklist

- [ ] Node.js 22+ or the Docker image.
- [ ] MongoDB 8.x reachable, with authentication enabled.
- [ ] A dedicated least-privilege database user.
- [ ] HTTPS certificate and DNS for the public hostname.
- [ ] `.env` populated from `deploy/env.production.example`, mode `600`.
- [ ] `ALLOWED_ORIGINS` and `APP_PUBLIC_URL` set to the exact HTTPS origin.
- [ ] `SECURE_COOKIES=true`.
- [ ] `TRUST_PROXY=true` only when behind a trusted proxy.
- [ ] SMTP credentials configured; recovery must be deliverable.
- [ ] `NODE_ENV=production`.
- [ ] Backups and log retention configured.
- [ ] `/api/health/ready` monitored.
- [ ] One application instance only.

The environment validator refuses to start production with HTTP origins, insecure cookies, a non-HTTPS public URL, or missing SMTP.

## 2. Environment

```powershell
Copy-Item deploy\env.production.example .env
# Replace every CHANGE_ME value.
```

Generate secrets if you add any (the app's session tokens are random at runtime; no static session secret is required):

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Important values:

| Variable | Production guidance |
| --- | --- |
| `NODE_ENV` | `production`. |
| `HOST` | `127.0.0.1` behind a local proxy; `0.0.0.0` in a container. |
| `PORT` | Default `3001`. |
| `ALLOWED_ORIGINS` | Exact HTTPS origin, no path or trailing slash. |
| `APP_PUBLIC_URL` | Same HTTPS origin; used in reset links. |
| `MONGODB_URI` | TLS and a dedicated user. URL-encode special characters. |
| `SECURE_COOKIES` | `true`. |
| `TRUST_PROXY` | `true` only behind Nginx/ALB that overwrites `X-Forwarded-*`. |
| `SMTP_HOST` | Required. Use a transactional provider. |
| `SESSION_TTL_DAYS` | 1-30. Shorter is safer. |
| `MAX_CONNECTIONS_PER_IP` | Tune to your NAT/proxy topology. |
| `MAX_CONNECTIONS` | Process-wide socket cap. |

Do not commit `.env`. Restrict it:

```bash
chmod 600 .env
```

## 3. MongoDB

### Create a database user

```js
use admin
db.createUser({
  user: "cosmic_app",
  pwd: "REPLACE_WITH_A_LONG_RANDOM_PASSWORD",
  roles: [{ role: "readWrite", db: "cosmic_spider" }]
})
```

Enable authentication and TLS in production. Do not expose MongoDB to the public internet.

### Indexes

The application declares indexes in the models. For a controlled deployment, run index synchronization once:

```js
await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
```

The unique `(sessionId, roundNumber, userId)` index on `gameresults` is essential for duplicate-scoring protection. Never drop it.

### Backups

- Use Atlas continuous backups or scheduled `mongodump`.
- Test restores.
- Prefer invalidating sessions after a restore; old session tokens may otherwise become valid again.
- Back up `users`, `gamesessions`, `gameresults`, and `moderationrecords` together.

## 4. Build and run without Docker

```powershell
npm ci
npm run build
$env:NODE_ENV="production"
npm start
```

The server looks for `dist/client/index.html` relative to its working directory and serves the SPA there. Run from the project root.

### systemd example

```ini
[Unit]
Description=Cosmic Spider
After=network.target mongod.service

[Service]
Type=simple
User=cosmic
Group=cosmic
WorkingDirectory=/opt/cosmic-spider
EnvironmentFile=/opt/cosmic-spider/.env
ExecStart=/usr/bin/node dist/server/index.js
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/cosmic-spider/.mail-outbox
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

`ProtectSystem=strict` is compatible only if the app does not need to write elsewhere. In production, reset email uses SMTP, not `.mail-outbox/`.

## 5. Reverse proxy (Nginx)

Use [`deploy/nginx.conf`](../deploy/nginx.conf) as a starting point. It:

- Redirects HTTP to HTTPS.
- Terminates TLS.
- Proxies HTTP and WebSocket traffic to `127.0.0.1:3001`.
- Sets `X-Forwarded-*` headers.
- Adds a proxy-level auth burst guard.
- Disables buffering for Socket.IO.
- Raises the WebSocket read timeout to 75 seconds.

Critical details:

- `TRUST_PROXY=true` is required for correct client IPs and secure-cookie behaviour behind the proxy.
- The proxy must not allow clients to spoof `X-Forwarded-For`; overwrite it.
- `ALLOWED_ORIGINS` must match the browser-visible HTTPS origin, not the upstream address.
- If you put a CDN in front, ensure WebSocket upgrades and cookies work, and update the CSP in `server/app.js` if asset origins change.
- Keep the SPA, API, and Socket.IO on the same site. Splitting them across origins requires CORS, cookie, CSP, and Socket.IO changes.

### Caddy alternative

```caddy
cosmic.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3001
}
```

Caddy handles WebSocket upgrades and certificates automatically. Set `TRUST_PROXY=true` and use HTTPS origins.

## 6. Docker Compose

The included `docker-compose.yml` runs the app and MongoDB with a named volume.

Create `.env` based on `deploy/env.compose.example`:

```dotenv
MONGO_ROOT_USERNAME=cosmic_root
MONGO_ROOT_PASSWORD=CHANGE_ME_LONG_RANDOM
MONGODB_URI=mongodb://cosmic_root:CHANGE_ME_LONG_RANDOM@mongo:27017/cosmic_spider?authSource=admin
ALLOWED_ORIGINS=https://cosmic.example.com
APP_PUBLIC_URL=https://cosmic.example.com
SECURE_COOKIES=true
TRUST_PROXY=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=CHANGE_ME
SMTP_PASS=CHANGE_ME
SMTP_FROM="Cosmic Spider <no-reply@cosmic.example.com>"
```

The app port is bound to `127.0.0.1:3001`, so expose it through a TLS proxy on the host or add a proxy service.

```bash
docker compose build
docker compose up -d
docker compose logs -f app
```

MongoDB is not published to the host and is reachable only on the Compose network.

### Note on the production guard

Compose sets `NODE_ENV=production`. If SMTP or HTTPS settings are missing, the container exits by design. Configure them, or explicitly override `NODE_ENV=development` for a local smoke test (never in real production).

## 7. Health and monitoring

- Liveness: `GET /api/health` returns `200 {"status":"ok"}`.
- Readiness: `GET /api/health/ready` returns `200` when MongoDB answers, otherwise `503`.
- The Docker image and Compose service include readiness health checks.

Monitor:

- Process restarts and fatal logs.
- Readiness failures.
- HTTP 5xx rate.
- `429` rate by route.
- Socket connection count and per-IP rejections.
- MongoDB connection pool, disk, and replication lag.
- SMTP failures (password recovery depends on it).

Logs are structured JSON. Ship them to your platform; do not log request bodies or cookies.

## 8. Scaling and availability

**Do not run multiple app replicas against the same rooms.** Room state, timers, and rate-limit counters are in-process. Two replicas would create split rooms and inconsistent scores.

To scale horizontally, you would need:

1. A shared room/game store or sticky routing plus a single owner per room.
2. A shared rate-limit store such as Redis.
3. A Socket.IO adapter such as `@socket.io/redis-adapter`.
4. Distributed timer ownership or idempotent transition jobs.
5. Shared presence and reconnect state.

A restart drops live rooms and rounds. Finished game records remain in MongoDB. Plan deploys during quiet periods or accept that live games end.

For availability, prefer:

- A single well-monitored instance with fast restart.
- MongoDB replication.
- A load balancer/WAF that tolerates WebSocket upgrades.
- Horizontal scaling only after the state migration above.

## 9. Upgrade and rollback

1. Back up MongoDB.
2. Pull the new release.
3. Run `npm ci` and `npm test` if the environment allows.
4. Run `npm run build`.
5. Restart the service.
6. Check `/api/health/ready`, logs, and a manual room join.
7. Keep the previous build directory for rollback.

Schema changes should be backward-compatible for one release. This project does not include migrations; use a migration tool or manual scripts for destructive changes.

## 10. Operational security

- Run as a non-root user.
- Keep `.env` at mode `600`.
- Restrict MongoDB network access.
- Use TLS for MongoDB.
- Rotate SMTP and database credentials periodically.
- Apply dependency updates and run `npm audit`.
- Do not enable `TRUST_PROXY` without a trusted proxy.
- Keep `ALLOWED_ORIGINS` exact; never use `*` with credentials.
- Review moderation records under your privacy policy.
- Set a data-retention period for sessions, results, and moderation records.
- Consider a WAF for volumetric protection; in-process rate limits are not a DDoS defence.

## 11. Known deployment limitations

- Single instance only.
- No zero-downtime deploy for live games.
- No built-in migrations.
- No admin dashboard.
- No email verification.
- No built-in metrics exporter; use logs and platform metrics.
- No automated backup encryption.
- No horizontal Socket.IO adapter.

See [RESIDUAL_RISKS.md](./RESIDUAL_RISKS.md).
