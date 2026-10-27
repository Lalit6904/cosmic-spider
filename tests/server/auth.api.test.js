import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../server/app.js";
import { GameHub } from "../../server/game/GameHub.js";
import { hashToken, randomToken } from "../../server/lib/crypto.js";
import { PasswordResetToken } from "../../server/models/PasswordResetToken.js";
import { Session } from "../../server/models/Session.js";
import { User } from "../../server/models/User.js";
import { httpLimiters } from "../../server/middleware/security.js";
const PASSWORD = "OrbitPass123";
const NEW_PASSWORD = "NebulaPass456";
const ORIGIN = "http://localhost:5173";
let app;
beforeEach(() => {
  app = createApp({ hub: new GameHub() });
});
async function register(agent, overrides = {}) {
  return agent.post("/api/auth/register").set("Origin", ORIGIN).send({
    username: overrides.username ?? "stardust",
    email: overrides.email ?? "stardust@example.com",
    password: overrides.password ?? PASSWORD
  });
}
describe("HTTP authentication", () => {
  it("registers a user with a hashed password and an opaque session cookie", async () => {
    const agent = request.agent(app);
    const response = await register(agent);
    expect(response.status).toBe(201);
    expect(response.body.user).toMatchObject({
      username: "stardust",
      email: "stardust@example.com"
    });
    expect(response.body.user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(response.body.csrfToken).toHaveLength(43);
    const setCookie = response.headers["set-cookie"];
    expect(setCookie.join(";")).toContain("cs_session=");
    expect(setCookie.join(";")).toContain("HttpOnly");
    expect(setCookie.join(";")).toContain("SameSite=Lax");
    expect(setCookie.join(";")).not.toContain(PASSWORD);
    const stored = await User.findById(response.body.user.id).select("+passwordHash");
    expect(stored?.passwordHash).not.toBe(PASSWORD);
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$12\$/);
  });
  it("rejects weak passwords, unknown fields and duplicate accounts", async () => {
    const agent = request.agent(app);
    const weak = await register(agent, { password: "short" });
    expect(weak.status).toBe(400);
    expect(weak.body.error.code).toBe("VALIDATION_ERROR");
    expect(weak.body.error.fields.password).toBeTruthy();
    const extra = await agent.post("/api/auth/register").set("Origin", ORIGIN).send({
      username: "extra",
      email: "extra@example.com",
      password: PASSWORD,
      role: "admin"
    });
    expect(extra.status).toBe(400);
    expect(extra.body.error.code).toBe("VALIDATION_ERROR");
    expect((await register(agent)).status).toBe(201);
    const duplicate = await register(request.agent(app), {
      username: "another",
      email: "STARDUST@example.com"
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("ACCOUNT_EXISTS");
  });
  it("restores the session and rotates CSRF when the readable cookie is missing", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const cookies = registered.headers["set-cookie"];
    const sessionCookie = cookies.find((cookie) => cookie.startsWith("cs_session=")).split(";")[0];
    const session = await agent.get("/api/auth/session").set("Origin", ORIGIN);
    expect(session.status).toBe(200);
    expect(session.body.authenticated).toBe(true);
    expect(session.body.user.username).toBe("stardust");
    expect(session.body.csrfToken).toBe(registered.body.csrfToken);
    const refreshed = await request(app).get("/api/auth/session").set("Origin", ORIGIN).set("Cookie", sessionCookie);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.authenticated).toBe(true);
    expect(refreshed.body.csrfToken).toHaveLength(43);
    expect(refreshed.body.csrfToken).not.toBe(registered.body.csrfToken);
    const refreshedCookie = refreshed.headers["set-cookie"].find(
      (cookie) => cookie.startsWith("cs_csrf=")
    ).split(";")[0];
    const logout = await request(app).post("/api/auth/logout").set("Origin", ORIGIN).set("Cookie", `${sessionCookie}; ${refreshedCookie}`).set("X-CSRF-Token", refreshed.body.csrfToken);
    expect(logout.status).toBe(204);
  });
  it("enforces the synchronizer CSRF token on state-changing routes", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const missing = await agent.post("/api/auth/logout").set("Origin", ORIGIN);
    expect(missing.status).toBe(401);
    const wrong = await agent.post("/api/auth/logout").set("Origin", ORIGIN).set("X-CSRF-Token", "x".repeat(43));
    expect(wrong.status).toBe(401);
    const logout = await agent.post("/api/auth/logout").set("Origin", ORIGIN).set("X-CSRF-Token", registered.body.csrfToken);
    expect(logout.status).toBe(204);
    const session = await agent.get("/api/auth/session").set("Origin", ORIGIN);
    expect(session.body.authenticated).toBe(false);
  });
  it("authenticates with generic errors, rotates the session and locks out repeated failures", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const originalCookie = registered.headers["set-cookie"].find((cookie) => cookie.startsWith("cs_session=")).split(";")[0];
    const wrong = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "stardust@example.com", password: "WrongPass999" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(wrong.body.error.message).toBe("Invalid email or password.");
    const unknown = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "missing@example.com", password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    const login = await agent.post("/api/auth/login").set("Origin", ORIGIN).send({ email: "STARDUST@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(registered.body.user.id);
    expect(login.body.csrfToken).toHaveLength(43);
    const oldSession = await request(app).get("/api/auth/session").set("Origin", ORIGIN).set("Cookie", originalCookie);
    expect(oldSession.body.authenticated).toBe(false);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post("/api/auth/login").set("Origin", ORIGIN).set("Cookie", originalCookie).send({ email: "stardust@example.com", password: `WrongPass99${attempt}` });
    }
    const locked = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "stardust@example.com", password: PASSWORD });
    expect(locked.status).toBe(401);
    const stillLocked = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "stardust@example.com", password: PASSWORD });
    expect(stillLocked.status).toBe(401);
  });
});
describe("password recovery", () => {
  it("returns the same response for known and unknown emails", async () => {
    const agent = request.agent(app);
    await register(agent);
    const known = await request(app).post("/api/auth/forgot-password").set("Origin", ORIGIN).send({ email: "stardust@example.com" });
    const unknown = await request(app).post("/api/auth/forgot-password").set("Origin", ORIGIN).send({ email: "nobody@example.com" });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.message).toMatch(/If an account exists/);
    expect(await PasswordResetToken.countDocuments()).toBe(1);
  });
  it("accepts a valid token exactly once and revokes every session", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const rawToken = randomToken(32);
    await PasswordResetToken.create({
      userId: registered.body.user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + 30 * 6e4)
    });
    const reset = await request(app).post("/api/auth/reset-password").set("Origin", ORIGIN).send({ token: rawToken, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(await Session.countDocuments({ userId: registered.body.user.id })).toBe(0);
    const oldSession = await agent.get("/api/auth/session").set("Origin", ORIGIN);
    expect(oldSession.body.authenticated).toBe(false);
    const reused = await request(app).post("/api/auth/reset-password").set("Origin", ORIGIN).send({ token: rawToken, password: NEW_PASSWORD });
    expect(reused.status).toBe(400);
    expect(reused.body.error.code).toBe("INVALID_RESET_TOKEN");
    const login = await request(app).post("/api/auth/login").set("Origin", ORIGIN).send({ email: "stardust@example.com", password: NEW_PASSWORD });
    expect(login.status).toBe(200);
  });
  it("rejects expired tokens", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const rawToken = randomToken(32);
    await PasswordResetToken.create({
      userId: registered.body.user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() - 1e3)
    });
    const response = await request(app).post("/api/auth/reset-password").set("Origin", ORIGIN).send({ token: rawToken, password: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_RESET_TOKEN");
  });
});
describe("profile, leaderboard and room APIs", () => {
  it("requires authentication and serves personal data only to its owner", async () => {
    expect((await request(app).get("/api/profile")).status).toBe(401);
    expect((await request(app).get("/api/leaderboard")).status).toBe(401);
    expect((await request(app).get("/api/rooms/public")).status).toBe(401);
    const agent = request.agent(app);
    await register(agent);
    const profile = await agent.get("/api/profile").set("Origin", ORIGIN);
    expect(profile.status).toBe(200);
    expect(profile.body.user.email).toBe("stardust@example.com");
    expect(profile.body.recentGames).toEqual([]);
    const board = await agent.get("/api/leaderboard").set("Origin", ORIGIN);
    expect(board.status).toBe(200);
    expect(board.body.leaderboard).toEqual([
      expect.objectContaining({ rank: 1, username: "stardust", score: 0 })
    ]);
  });
  it("lists only public rooms and never exposes their secret state", async () => {
    const agent = request.agent(app);
    const registered = await register(agent);
    const hub = new GameHub();
    const localApp = createApp({ hub });
    const localAgent = request.agent(localApp);
    const login = await localAgent.post("/api/auth/login").set("Origin", ORIGIN).send({ email: "stardust@example.com", password: PASSWORD });
    expect(login.status).toBe(200);
    await hub.createRoom(
      { id: registered.body.user.id, username: "stardust" },
      {
        name: "Public Nebula",
        visibility: "public",
        maxPlayers: 4,
        roundDurationSeconds: 60,
        totalRounds: 2
      }
    );
    await hub.createRoom(
      { id: registered.body.user.id, username: "stardust" },
      {
        name: "Hidden Nebula",
        visibility: "private",
        maxPlayers: 4,
        roundDurationSeconds: 60,
        totalRounds: 2
      }
    );
    const response = await localAgent.get("/api/rooms/public").set("Origin", ORIGIN);
    expect(response.status).toBe(200);
    expect(response.body.rooms).toHaveLength(1);
    expect(response.body.rooms[0]).toMatchObject({
      name: "Public Nebula",
      playerCount: 0,
      maxPlayers: 4,
      status: "waiting"
    });
    expect(JSON.stringify(response.body)).not.toContain("secretWord");
    hub.shutdown();
  });
});
describe("HTTP security boundary", () => {
  it("rejects disallowed origins and dangerous object keys", async () => {
    const evil = await request(app).post("/api/auth/login").set("Origin", "https://evil.example").send({ email: "stardust@example.com", password: PASSWORD });
    expect(evil.status).toBe(400);
    expect(evil.body.error.code).toBe("ORIGIN_REJECTED");
    const polluted = await request(app).post("/api/auth/login").set("Origin", ORIGIN).set("Content-Type", "application/json").send(
      '{"email":"stardust@example.com","password":"OrbitPass123","__proto__":{"admin":true}}'
    );
    expect(polluted.status).toBe(400);
    expect(polluted.body.error.code).toBe("INVALID_INPUT");
  });
  it("requires JSON content type for mutations", async () => {
    const response = await request(app).post("/api/auth/login").set("Origin", ORIGIN).set("Content-Type", "text/plain").send('{"email":"a@b.co"}');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("JSON_REQUIRED");
  });
  it("sets hardening headers and hides the framework banner", async () => {
    const response = await request(app).get("/api/health").set("Origin", ORIGIN);
    expect(response.status).toBe(200);
    expect(response.headers["x-powered-by"]).toBeUndefined();
    expect(response.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(response.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(response.headers["permissions-policy"]).toContain("camera=()");
  });
  it("reports readiness only when MongoDB is reachable", async () => {
    const response = await request(app).get("/api/health/ready");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
  });
  it("rate limits repeated recovery attempts", async () => {
    const responses = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      responses.push(
        await request(app).post("/api/auth/forgot-password").set("Origin", ORIGIN).send({ email: "nobody@example.com" })
      );
    }
    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5]?.status).toBe(429);
    expect(responses[5]?.body.error.code).toBe("RATE_LIMITED");
    expect(httpLimiters.forgot).toBeTruthy();
  });
  it("returns a structured 404 for unknown API endpoints", async () => {
    const response = await request(app).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });
});
