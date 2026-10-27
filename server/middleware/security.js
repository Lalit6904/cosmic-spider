import { MemoryStore, rateLimit } from "express-rate-limit";
import { env } from "../config/env.js";
import { badRequest } from "../lib/errors.js";
import { securityLog } from "../lib/logger.js";
function requestId(req, res, next) {
  req.requestId = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
}
function originGuard(req, _res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const origin = req.get("origin");
  if (!origin) {
    if (env.isProduction) {
      next(badRequest("ORIGIN_REQUIRED", "A valid Origin header is required."));
      return;
    }
    next();
    return;
  }
  if (!env.allowedOrigins.includes(origin)) {
    securityLog.warn({ origin, ip: req.ip, path: req.path }, "Rejected HTTP origin");
    next(badRequest("ORIGIN_REJECTED", "Request origin is not allowed."));
    return;
  }
  next();
}
const DANGEROUS_KEYS = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
function hasDangerousKey(value, depth = 0) {
  if (depth > 20 || value == null || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => hasDangerousKey(entry, depth + 1));
  for (const [key, child] of Object.entries(value)) {
    if (DANGEROUS_KEYS.has(key) || key.startsWith("$") || key.includes(".")) return true;
    if (hasDangerousKey(child, depth + 1)) return true;
  }
  return false;
}
function rejectDangerousInput(req, _res, next) {
  if (hasDangerousKey(req.body) || hasDangerousKey(req.query)) {
    securityLog.warn({ ip: req.ip, path: req.path }, "Rejected dangerous object keys");
    next(badRequest("INVALID_INPUT", "Request contains a disallowed field."));
    return;
  }
  next();
}
function requireJson(req, _res, next) {
  if (["POST", "PUT", "PATCH"].includes(req.method) && !req.is("application/json")) {
    next(badRequest("JSON_REQUIRED", "Content-Type must be application/json."));
    return;
  }
  next();
}
function asyncHandler(handler) {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}
const stores = [];
function resetHttpRateLimits() {
  for (const store of stores) store.resetAll();
}
function makeLimiter(name, windowMs, limit, message) {
  const store = new MemoryStore();
  stores.push(store);
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    store,
    handler: (req, res) => {
      securityLog.warn({ ip: req.ip, limit: name, path: req.path }, "HTTP rate limit exceeded");
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message,
          requestId: req.requestId
        }
      });
    }
  });
}
const httpLimiters = {
  global: makeLimiter("global", 15 * 6e4, 600, "Too many requests. Please wait and try again."),
  login: makeLimiter("login", 15 * 6e4, 15, "Too many sign-in attempts. Try again later."),
  register: makeLimiter("register", 60 * 6e4, 8, "Too many account creations from this network."),
  forgot: makeLimiter("forgot", 15 * 6e4, 5, "Too many recovery requests. Try again later."),
  reset: makeLimiter("reset", 15 * 6e4, 8, "Too many reset attempts. Try again later."),
  passwordChange: makeLimiter("password-change", 60 * 6e4, 10, "Too many password changes."),
  profile: makeLimiter("profile", 15 * 6e4, 120, "Too many profile requests."),
  leaderboard: makeLimiter("leaderboard", 15 * 6e4, 120, "Too many leaderboard requests.")
};
export {
  asyncHandler,
  httpLimiters,
  originGuard,
  rejectDangerousInput,
  requestId,
  requireJson,
  resetHttpRateLimits
};
