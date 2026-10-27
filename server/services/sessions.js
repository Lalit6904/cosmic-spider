import { env } from "../config/env.js";
import { hashToken, randomToken, constantTimeEqualHex } from "../lib/crypto.js";
import { unauthorized } from "../lib/errors.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
const CSRF_COOKIE_NAME = "cs_csrf";
function cookieBase() {
  return {
    httpOnly: true,
    secure: env.SECURE_COOKIES,
    sameSite: "lax",
    path: "/"
  };
}
function setSessionCookie(res, token) {
  res.cookie(env.SESSION_COOKIE_NAME, token, {
    ...cookieBase(),
    maxAge: env.sessionTtlMs
  });
}
function setCsrfCookie(res, token) {
  res.cookie(CSRF_COOKIE_NAME, token, {
    ...cookieBase(),
    httpOnly: false,
    maxAge: env.sessionTtlMs
  });
}
function clearAuthCookies(res) {
  res.clearCookie(env.SESSION_COOKIE_NAME, cookieBase());
  res.clearCookie(CSRF_COOKIE_NAME, { ...cookieBase(), httpOnly: false });
}
async function createSession(userId, userAgent = "") {
  const token = randomToken(32);
  const csrfToken = randomToken(32);
  const session = await Session.create({
    userId,
    tokenHash: hashToken(token),
    csrfHash: hashToken(csrfToken),
    expiresAt: new Date(Date.now() + env.sessionTtlMs),
    userAgent: userAgent.slice(0, 300)
  });
  return { token, csrfToken, session };
}
function issueSession(res, material) {
  setSessionCookie(res, material.token);
  setCsrfCookie(res, material.csrfToken);
}
function toAuthUser(user) {
  return {
    id: user._id.toString(),
    username: user.username,
    email: user.email ?? "",
    stats: {
      gamesPlayed: user.stats?.gamesPlayed ?? 0,
      wins: user.stats?.wins ?? 0,
      correctGuesses: user.stats?.correctGuesses ?? 0,
      totalPoints: user.stats?.totalPoints ?? 0
    },
    createdAt: (user.createdAt ?? /* @__PURE__ */ new Date(0)).toISOString()
  };
}
async function authenticateRequest(req) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token !== "string" || token.length < 20) return null;
  const session = await Session.findOne({
    tokenHash: hashToken(token),
    expiresAt: { $gt: /* @__PURE__ */ new Date() }
  });
  if (!session) return null;
  const user = await User.findById(session.userId).select("+email");
  if (!user) {
    await Session.deleteOne({ _id: session._id });
    return null;
  }
  return { session, user: toAuthUser(user) };
}
function requireAuth(req) {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
function assertCsrf(req) {
  const auth = requireAuth(req);
  const header = req.get("x-csrf-token");
  if (typeof header !== "string" || header.length < 20 || header.length > 200) {
    throw unauthorized("Your security token is missing. Refresh the page and try again.");
  }
  const headerHash = hashToken(header);
  if (!constantTimeEqualHex(headerHash, auth.session.csrfHash)) {
    throw unauthorized("Your security token is invalid. Refresh the page and try again.");
  }
}
function csrfTokenForRequest(req) {
  const auth = req.auth;
  if (!auth) return null;
  const token = req.cookies?.[CSRF_COOKIE_NAME];
  if (typeof token !== "string" || token.length < 20) return null;
  return constantTimeEqualHex(hashToken(token), auth.session.csrfHash) ? token : null;
}
async function ensureCsrfToken(req, res) {
  const auth = req.auth;
  if (!auth) return null;
  const existing = csrfTokenForRequest(req);
  if (existing) return existing;
  const csrfToken = randomToken(32);
  await Session.updateOne({ _id: auth.session._id }, { $set: { csrfHash: hashToken(csrfToken) } });
  setCsrfCookie(res, csrfToken);
  return csrfToken;
}
async function rotateSession(req, res, userId) {
  const oldToken = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof oldToken === "string") {
    await Session.deleteOne({ tokenHash: hashToken(oldToken) });
  }
  const material = await createSession(userId, req.get("user-agent") ?? "");
  issueSession(res, material);
  return material;
}
async function revokeCurrentSession(req) {
  const token = req.cookies?.[env.SESSION_COOKIE_NAME];
  if (typeof token === "string") {
    await Session.deleteOne({ tokenHash: hashToken(token) });
  }
}
async function revokeAllSessions(userId) {
  await Session.deleteMany({ userId });
}
export {
  CSRF_COOKIE_NAME,
  assertCsrf,
  authenticateRequest,
  clearAuthCookies,
  createSession,
  csrfTokenForRequest,
  ensureCsrfToken,
  issueSession,
  requireAuth,
  revokeAllSessions,
  revokeCurrentSession,
  rotateSession,
  setCsrfCookie,
  setSessionCookie,
  toAuthUser
};
