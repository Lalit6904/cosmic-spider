import { Server } from "socket.io";
import { parseCookie } from "cookie";
import { ZodError } from "zod";
import { DRAWING_LIMITS } from "../../shared/protocol.js";
import { env } from "../config/env.js";
import { hashToken } from "../lib/crypto.js";
import { AppError, zodFields } from "../lib/errors.js";
import { logger, securityLog } from "../lib/logger.js";
import { Session } from "../models/Session.js";
import { User } from "../models/User.js";
import {
  chatSchema,
  drawingEndSchema,
  drawingStrokeSchema,
  emptySchema,
  guessSchema,
  moderationActionSchema,
  moderationReportSchema,
  readySchema,
  roomCreateSchema,
  roomJoinSchema
} from "../validation/schemas.js";
import { RateLimiter } from "./rateLimiter.js";
function clientIp(socket) {
  if (env.TRUST_PROXY) {
    const forwarded = socket.handshake.headers["x-forwarded-for"];
    const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    if (raw) {
      const first = raw.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return socket.handshake.address;
}
function originAllowed(origin) {
  if (!origin) return !env.isProduction;
  return env.allowedOrigins.includes(origin);
}
function reply(ack, response) {
  if (ack) {
    try {
      ack(response);
    } catch {
      // Client acknowledgements are best-effort.
    }
  }
}
class RealtimeService {
  io;
  hub;
  rate = new RateLimiter();
  connectionCountByIp = /* @__PURE__ */ new Map();
  socketsByUser = /* @__PURE__ */ new Map();
  connectionCount = 0;
  constructor(httpServer, hub) {
    this.hub = hub;
    this.io = new Server(httpServer, {
      path: "/socket.io",
      serveClient: false,
      maxHttpBufferSize: DRAWING_LIMITS.maxPayloadBytes,
      pingInterval: 25e3,
      pingTimeout: 2e4,
      connectTimeout: 15e3,
      cors: {
        origin: (origin, callback) => {
          if (originAllowed(origin)) callback(null, true);
          else callback(new Error("Origin not allowed"));
        },
        credentials: true,
        methods: ["GET", "POST"]
      },
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        if (!originAllowed(origin)) {
          securityLog.warn({ origin, ip: request.socket.remoteAddress }, "Rejected Socket.IO origin");
          callback("Origin not allowed", false);
          return;
        }
        callback(null, true);
      }
    });
    this.hub.attach(this.io);
    this.io.use((socket, next) => {
      void this.authenticate(socket, next);
    });
    this.io.on("connection", (socket) => {
      this.onConnection(socket);
    });
  }
  getConnectionCount() {
    return this.connectionCount;
  }
  dispose() {
    this.rate.dispose();
    this.hub.shutdown();
    this.io.close();
  }
  async authenticate(socket, next) {
    try {
      const ip = clientIp(socket);
      if (this.connectionCount >= env.MAX_CONNECTIONS) {
        next(new Error("SERVER_BUSY"));
        return;
      }
      if ((this.connectionCountByIp.get(ip) ?? 0) >= env.MAX_CONNECTIONS_PER_IP) {
        next(new Error("TOO_MANY_CONNECTIONS"));
        return;
      }
      const cookieHeader = socket.request.headers.cookie;
      if (!cookieHeader) {
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      const cookies = parseCookie(cookieHeader);
      const token = cookies[env.SESSION_COOKIE_NAME];
      if (!token) {
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      const session = await Session.findOne({
        tokenHash: hashToken(token),
        expiresAt: { $gt: /* @__PURE__ */ new Date() }
      });
      if (!session) {
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      const user = await User.findById(session.userId);
      if (!user) {
        await Session.deleteOne({ _id: session._id });
        next(new Error("UNAUTHENTICATED"));
        return;
      }
      const data = socket.data;
      data.userId = user._id.toString();
      data.username = user.username;
      data.sessionId = session._id.toString();
      data.ip = ip;
      data.roomId = null;
      data.lastSessionCheck = Date.now();
      this.connectionCount += 1;
      this.connectionCountByIp.set(ip, (this.connectionCountByIp.get(ip) ?? 0) + 1);
      const previousSocketId = this.socketsByUser.get(data.userId);
      if (previousSocketId) {
        const previous = this.io.sockets.sockets.get(previousSocketId);
        if (previous) {
          previous.emit("session:expired", { message: "This account connected from another browser tab." });
          previous.disconnect(true);
        }
      }
      this.socketsByUser.set(data.userId, socket.id);
      next();
    } catch (error) {
      logger.error({ err: error }, "Socket authentication failed");
      next(new Error("UNAUTHENTICATED"));
    }
  }
  onConnection(socket) {
    const identity = () => ({ id: socket.data.userId, username: socket.data.username });
    const ensureSession = async () => {
      const now = Date.now();
      if (now - socket.data.lastSessionCheck < 15e3) return;
      socket.data.lastSessionCheck = now;
      const session = await Session.findById(socket.data.sessionId);
      if (!session || session.expiresAt.getTime() <= now) {
        socket.emit("session:expired", { message: "Your session expired. Please sign in again." });
        socket.disconnect(true);
        throw new AppError(401, "UNAUTHENTICATED", "Your session expired.");
      }
    };
    const limited = (key, max, windowMs) => {
      const result = this.rate.consume(`${socket.data.userId}:${key}`, max, windowMs);
      if (!result.allowed) {
        throw new AppError(429, "RATE_LIMITED", "Too many actions. Please slow down.");
      }
    };
    const ipLimited = (key, max, windowMs) => {
      const result = this.rate.consume(`ip:${socket.data.ip}:${key}`, max, windowMs);
      if (!result.allowed) {
        throw new AppError(429, "RATE_LIMITED", "Too many actions. Please slow down.");
      }
    };
    const handle = (event, schema, handler, options = {}, socketInstance = socket) => {
      socketInstance.on(event, (raw, ack) => {
        void (async () => {
          try {
            await ensureSession();
            limited("all-events", 180, 1e4);
            ipLimited("all-events", 600, 1e4);
            if (options.rate) limited(options.rate.key, options.rate.max, options.rate.windowMs);
            if (options.ipRate) ipLimited(options.ipRate.key, options.ipRate.max, options.ipRate.windowMs);
            const result = schema.safeParse(raw ?? {});
            if (!result.success) {
              reply(ack, {
                ok: false,
                error: {
                  code: "VALIDATION_ERROR",
                  message: "Invalid request payload."
                }
              });
              socketInstance.emit("error", {
                code: "VALIDATION_ERROR",
                message: "Invalid request payload."
              });
              securityLog.info(
                { userId: socket.data.userId, event, fields: Object.keys(zodFields(result.error)) },
                "Rejected socket payload"
              );
              return;
            }
            await handler(result.data, ack);
          } catch (error) {
            this.handleEventError(socketInstance, event, error, ack);
          }
        })();
      });
    };
    handle("room:list", emptySchema, (_payload, ack) => {
      limited("room:list", 30, 6e4);
      reply(ack, { ok: true, data: this.hub.listPublicRooms() });
      socket.emit("room:list", this.hub.listPublicRooms());
    });
    handle("room:create", roomCreateSchema, async (payload, ack) => {
      const result = await this.hub.createRoom(identity(), payload);
      reply(ack, { ok: true, data: result });
    }, { rate: { key: "room:create", max: 5, windowMs: 10 * 6e4 } });
    handle("room:join", roomJoinSchema, (payload, ack) => {
      const result = this.hub.joinRoom(identity(), payload.code, socket.id);
      socket.data.roomId = result.roomId;
      reply(ack, { ok: true, data: { roomId: result.roomId, state: result.state } });
    }, { rate: { key: "room:join", max: 12, windowMs: 6e4 } });
    handle("room:leave", emptySchema, async (_payload, ack) => {
      limited("room:leave", 10, 6e4);
      await this.hub.leaveRoom(socket.data.userId);
      socket.data.roomId = null;
      reply(ack, { ok: true });
    });
    handle("game:ready", readySchema, (payload, ack) => {
      limited("game:ready", 30, 6e4);
      this.hub.setReady(socket.data.userId, payload.ready);
      reply(ack, { ok: true });
    });
    handle("game:start", emptySchema, async (_payload, ack) => {
      limited("game:start", 6, 6e4);
      await this.hub.startGame(socket.data.userId);
      reply(ack, { ok: true });
    });
    handle("game:playAgain", emptySchema, async (_payload, ack) => {
      limited("game:playAgain", 6, 6e4);
      await this.hub.playAgain(socket.data.userId);
      reply(ack, { ok: true });
    });
    handle("game:requestState", emptySchema, (_payload, ack) => {
      limited("game:requestState", 60, 6e4);
      const state = this.hub.getState(socket.data.userId);
      reply(ack, { ok: true, data: state });
      socket.emit("room:state", state);
    });
    handle("drawing:stroke", drawingStrokeSchema, (payload, ack) => {
      limited("drawing:stroke", DRAWING_LIMITS.maxEventsPerSecond, 1e3);
      ipLimited("drawing:stroke", 180, 1e3);
      this.hub.addStroke(socket.data.userId, socket.id, {
        id: payload.strokeId,
        color: payload.color,
        width: payload.width,
        tool: payload.tool,
        points: payload.points
      });
      reply(ack, { ok: true });
    });
    handle("drawing:end", drawingEndSchema, (payload, ack) => {
      limited("drawing:end", 30, 1e3);
      this.hub.endStroke(socket.data.userId, payload.strokeId);
      reply(ack, { ok: true });
    });
    handle("drawing:undo", emptySchema, (_payload, ack) => {
      limited("drawing:undo", 8, 1e3);
      this.hub.undoStroke(socket.data.userId);
      reply(ack, { ok: true });
    });
    handle("drawing:redo", emptySchema, (_payload, ack) => {
      limited("drawing:redo", 8, 1e3);
      this.hub.redoStroke(socket.data.userId);
      reply(ack, { ok: true });
    });
    handle("drawing:clear", emptySchema, (_payload, ack) => {
      limited("drawing:clear", 3, 5e3);
      this.hub.clearDrawing(socket.data.userId);
      reply(ack, { ok: true });
    });
    handle("guess:submit", guessSchema, async (payload, ack) => {
      limited("guess:submit", 4, 2e3);
      const result = await this.hub.submitGuess(socket.data.userId, payload.text);
      const response = {
        correct: result.correct,
        points: result.points,
        message: result.correct ? `Correct! +${result.points} points` : "Not quite. Try another guess."
      };
      socket.emit("guess:result", response);
      reply(ack, { ok: true, data: response });
    });
    handle("chat:send", chatSchema, (payload, ack) => {
      limited("chat:send", 6, 1e4);
      const message = this.hub.submitChat(socket.data.userId, payload.text);
      reply(ack, { ok: true, data: message });
    }, { rate: { key: "chat:send", max: 6, windowMs: 1e4 } });
    handle("moderation:action", moderationActionSchema, async (payload, ack) => {
      limited("moderation:action", 15, 6e4);
      await this.hub.moderationAction(socket.data.userId, payload.action, payload.targetUserId);
      reply(ack, { ok: true });
    });
    handle("moderation:report", moderationReportSchema, async (payload, ack) => {
      limited("moderation:report", 3, 10 * 6e4);
      await this.hub.reportPlayer(socket.data.userId, payload.targetUserId, payload.reason);
      reply(ack, { ok: true });
    });
    socket.on("disconnect", (reason) => {
      if (this.socketsByUser.get(socket.data.userId) === socket.id) {
        this.socketsByUser.delete(socket.data.userId);
        void this.hub.disconnectSocket(socket.data.userId);
      }
      this.connectionCount = Math.max(0, this.connectionCount - 1);
      const ip = socket.data.ip;
      const ipCount = Math.max(0, (this.connectionCountByIp.get(ip) ?? 1) - 1);
      if (ipCount === 0) this.connectionCountByIp.delete(ip);
      else this.connectionCountByIp.set(ip, ipCount);
      logger.debug({ userId: socket.data.userId, reason }, "Socket disconnected");
    });
  }
  handleEventError(socket, event, error, ack) {
    if (error instanceof AppError) {
      if (error.status === 429) {
        securityLog.warn(
          { userId: socket.data.userId, event, code: error.code },
          "Socket rate limit or conflict"
        );
      }
      reply(ack, {
        ok: false,
        error: {
          code: error.code,
          message: error.expose ? error.message : "Request failed."
        }
      });
      socket.emit("error", { code: error.code, message: error.expose ? error.message : "Request failed." });
      return;
    }
    if (error instanceof ZodError) {
      reply(ack, {
        ok: false,
        error: { code: "VALIDATION_ERROR", message: "Invalid request payload." }
      });
      return;
    }
    logger.error({ err: error, event, userId: socket.data.userId }, "Unhandled socket event error");
    reply(ack, { ok: false, error: { code: "INTERNAL_ERROR", message: "Something went wrong." } });
    socket.emit("error", { code: "INTERNAL_ERROR", message: "Something went wrong." });
  }
}
export {
  RealtimeService
};
