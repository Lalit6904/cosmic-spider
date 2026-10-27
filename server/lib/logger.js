import pino from "pino";
import { env } from "../config/env.js";
const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "cosmic-spider", env: env.NODE_ENV },
  redact: {
    paths: [
      "req.headers.cookie",
      "req.headers.authorization",
      'req.headers["x-csrf-token"]',
      'res.headers["set-cookie"]',
      "password",
      "currentPassword",
      "newPassword",
      "token",
      "csrfToken",
      "secret",
      "word",
      "*.password",
      "*.token",
      "*.csrfToken"
    ],
    censor: "[REDACTED]"
  },
  timestamp: pino.stdTimeFunctions.isoTime
});
const securityLog = logger.child({ channel: "security" });
const gameLog = logger.child({ channel: "game" });
export {
  gameLog,
  logger,
  securityLog
};
