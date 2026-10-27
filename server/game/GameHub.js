import {
  calculatePoints,
  maskWord,
  normalizeGuess,
  revealHintPositions,
  toLeaderboard
} from "../../shared/game.js";
import {
  CHAT_LIMITS,
  DRAWING_LIMITS,
  GUESS_LIMITS
} from "../../shared/protocol.js";
import { Types } from "mongoose";
import { pickWord } from "./words.js";
import { GameRoom } from "../models/GameRoom.js";
import { GameSession } from "../models/GameSession.js";
import { GameResult } from "../models/GameResult.js";
import { ModerationRecord } from "../models/ModerationRecord.js";
import { User } from "../models/User.js";
import { badRequest, conflict, forbidden, notFound, tooManyRequests } from "../lib/errors.js";
import { gameLog, logger, securityLog } from "../lib/logger.js";
import { randomId } from "../lib/crypto.js";
const ROUND_END_DELAY_MS = 6e3;
const DISCONNECT_DRAWER_GRACE_MS = 1e4;
const OWNER_TRANSFER_GRACE_MS = 3e4;
const EMPTY_ROOM_TTL_MS = 10 * 6e4;
const ROOM_MAX_AGE_MS = 6 * 60 * 6e4;
const MUTE_DURATION_MS = 5 * 6e4;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function roomChannel(roomId) {
  return `room:${roomId}`;
}
function makeCode() {
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)] ?? "X";
  }
  return code;
}
function systemMessage(text) {
  return {
    id: randomId(8),
    kind: "system",
    userId: null,
    username: "Cosmic Spider",
    text,
    createdAt: Date.now()
  };
}
const MAX_GUESS_FEED = 60;
function maskGuess(text) {
  return [...text].map((character) => character === " " ? " " : "\u2022").join("");
}
function publicPlayer(player, ownerId) {
  return {
    id: player.userId,
    username: player.username,
    score: player.score,
    correctGuesses: player.correctGuesses,
    connected: player.connected,
    ready: player.ready,
    isOwner: player.userId === ownerId,
    guessedThisRound: player.guessedThisRound,
    mutedUntil: player.mutedUntil
  };
}
class GameHub {
  rooms = /* @__PURE__ */ new Map();
  userRooms = /* @__PURE__ */ new Map();
  io = null;
  ticker = null;
  attach(io) {
    this.io = io;
    if (!this.ticker) {
      this.ticker = setInterval(() => this.tick(), 1e3);
      this.ticker.unref?.();
    }
  }
  shutdown() {
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    for (const room of this.rooms.values()) {
      this.clearTimers(room);
    }
    this.rooms.clear();
    this.userRooms.clear();
  }
  getRoomCount() {
    return this.rooms.size;
  }
  listPublicRooms() {
    return [...this.rooms.values()].filter((room) => room.visibility === "public").map((room) => ({
      code: room.code,
      name: room.name,
      playerCount: room.players.size,
      maxPlayers: room.maxPlayers,
      roundDurationSeconds: room.roundDurationSeconds,
      totalRounds: room.totalRounds,
      status: room.phase === "lobby" ? "waiting" : "playing",
      ownerName: room.players.get(room.ownerId)?.username ?? "Unknown",
      updatedAt: room.lastActivityAt
    })).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
  }
  async createRoom(user, options) {
    if (this.userRooms.has(user.id)) {
      throw conflict("ALREADY_IN_ROOM", "Leave your current room before creating another.");
    }
    const ownedCount = [...this.rooms.values()].filter(
      (room2) => room2.ownerId === user.id && room2.phase !== "gameOver"
    ).length;
    if (ownedCount >= 2) {
      throw conflict("ROOM_LIMIT", "You can own at most two active rooms.");
    }
    let code = makeCode();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const existsInMemory = [...this.rooms.values()].some((room2) => room2.code === code);
      const existsInDb = await GameRoom.exists({ code });
      if (!existsInMemory && !existsInDb) break;
      code = makeCode();
    }
    const dbRoom = await GameRoom.create({
      code,
      name: options.name,
      ownerId: new Types.ObjectId(user.id),
      visibility: options.visibility,
      maxPlayers: options.maxPlayers,
      roundDurationSeconds: options.roundDurationSeconds,
      totalRounds: options.totalRounds,
      status: "open"
    });
    const now = Date.now();
    const room = {
      id: dbRoom._id.toString(),
      dbId: dbRoom._id,
      code,
      name: options.name,
      visibility: options.visibility,
      ownerId: user.id,
      maxPlayers: options.maxPlayers,
      roundDurationSeconds: options.roundDurationSeconds,
      totalRounds: options.totalRounds,
      phase: "lobby",
      roundNumber: 0,
      currentDrawerId: null,
      lastDrawerId: null,
      turnOrder: [],
      roundStartedAt: null,
      roundEndsAt: null,
      roundTimer: null,
      roundToken: 0,
      secretWord: "",
      revealedPositions: /* @__PURE__ */ new Set(),
      hintStage: 0,
      players: /* @__PURE__ */ new Map(),
      strokes: [],
      strokePointCount: 0,
      redoStack: [],
      activeStroke: null,
      chat: [],
      maskedGuesses: [],
      lastRound: null,
      gameOver: null,
      sessionId: null,
      nextRoundTimer: null,
      drawerDisconnectTimer: null,
      ownerTransferTimer: null,
      cleanupTimer: null,
      createdAt: now,
      lastActivityAt: now,
      bannedUserIds: /* @__PURE__ */ new Set()
    };
    this.rooms.set(room.id, room);
    gameLog.info({ roomId: room.id, code, ownerId: user.id }, "Room created");
    return { code, roomId: room.id };
  }
  joinRoom(user, code, socketId) {
    const room = [...this.rooms.values()].find((candidate) => candidate.code === code);
    if (!room) throw notFound("That room code does not exist or the room has closed.");
    if (room.bannedUserIds.has(user.id)) throw forbidden("You were removed from this room.");
    const existingMembership = this.userRooms.get(user.id);
    if (existingMembership && existingMembership !== room.id) {
      throw conflict("ALREADY_IN_ROOM", "Leave your current room before joining another.");
    }
    const existingPlayer = room.players.get(user.id);
    let player = existingPlayer;
    if (!player) {
      if (room.phase !== "lobby") {
        throw conflict("GAME_IN_PROGRESS", "This game is already in progress. Only reconnecting players can rejoin.");
      }
      if (room.players.size >= room.maxPlayers) {
        throw conflict("ROOM_FULL", "That room is full.");
      }
      player = {
        userId: user.id,
        username: user.username,
        socketId,
        connected: true,
        score: 0,
        correctGuesses: 0,
        ready: false,
        joinedAt: Date.now(),
        guessedThisRound: false,
        roundPoints: 0,
        guessCount: 0,
        lastGuessAt: 0,
        lastChatAt: 0,
        mutedUntil: null
      };
      room.players.set(user.id, player);
      room.chat.push(systemMessage(`${user.username} entered the room.`));
      this.trimChat(room);
    } else {
      if (player.connected && player.socketId && player.socketId !== socketId) {
        // Reconnect: replace the previous socket without marking a disconnect.
      }
      player.connected = true;
      player.socketId = socketId;
      player.username = user.username;
      if (room.drawerDisconnectTimer) {
        clearTimeout(room.drawerDisconnectTimer);
        room.drawerDisconnectTimer = null;
      }
      if (room.ownerTransferTimer) {
        clearTimeout(room.ownerTransferTimer);
        room.ownerTransferTimer = null;
      }
    }
    this.userRooms.set(user.id, room.id);
    this.cancelCleanup(room);
    room.lastActivityAt = Date.now();
    if (player.userId === room.ownerId) {
      this.cancelOwnerTransfer(room);
    }
    if (room.phase === "round" && room.currentDrawerId === user.id) {
      this.cancelDrawerDisconnect(room);
    }
    this.io?.sockets.sockets.get(socketId)?.join(roomChannel(room.id));
    if (room.players.size > 1) {
      this.emitToRoom(room, "room:playerJoined", { userId: user.id, username: user.username });
      this.broadcastChat(room, room.chat[room.chat.length - 1]);
    }
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, userId: user.id, reconnected: Boolean(existingPlayer) }, "Player joined room");
    return { roomId: room.id, channel: roomChannel(room.id), state: this.getRoomState(room, user.id) };
  }
  async leaveRoom(userId, reason = "leave") {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player) return;
    const username = player.username;
    const wasDrawer = room.phase === "round" && room.currentDrawerId === userId;
    const wasOwner = room.ownerId === userId;
    if (reason === "kick") {
      room.bannedUserIds.add(userId);
    }
    room.players.delete(userId);
    this.userRooms.delete(userId);
    room.lastActivityAt = Date.now();
    if (player.socketId) {
      const socket = this.io?.sockets.sockets.get(player.socketId);
      if (socket) {
        socket.leave(roomChannel(room.id));
        socket.data.roomId = null;
      }
    }
    if (wasDrawer && room.phase === "round") {
      await this.finishRound(room, "drawerLeft");
    }
    if (wasOwner) {
      this.transferOwnership(room);
    }
    const message = systemMessage(`${username} ${reason === "kick" ? "was removed from the room" : "left the room"}.`);
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    this.emitToRoom(room, "room:playerLeft", { userId, username, reason });
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, userId, reason }, "Player left room");
    if (room.players.size === 0) {
      await this.closeRoom(room, "empty");
    } else {
      this.scheduleCleanup(room);
    }
  }
  async disconnectSocket(userId) {
    const room = this.getRoomForUser(userId);
    if (!room) return;
    const player = room.players.get(userId);
    if (!player || !player.connected) return;
    player.connected = false;
    player.socketId = null;
    room.lastActivityAt = Date.now();
    this.emitRoomState(room);
    if (room.phase === "round" && room.currentDrawerId === userId) {
      this.cancelDrawerDisconnect(room);
      room.drawerDisconnectTimer = setTimeout(() => {
        void (async () => {
          const current = this.rooms.get(room.id);
          const drawer = current?.players.get(userId);
          if (current && current.phase === "round" && current.currentDrawerId === userId && drawer && !drawer.connected) {
            await this.finishRound(current, "drawerLeft");
          }
        })();
      }, DISCONNECT_DRAWER_GRACE_MS);
      room.drawerDisconnectTimer.unref?.();
    }
    if (room.ownerId === userId) {
      this.cancelOwnerTransfer(room);
      room.ownerTransferTimer = setTimeout(() => {
        const current = this.rooms.get(room.id);
        if (current && current.ownerId === userId && !current.players.get(userId)?.connected) {
          this.transferOwnership(current);
          this.emitRoomState(current);
        }
      }, OWNER_TRANSFER_GRACE_MS);
      room.ownerTransferTimer.unref?.();
    }
    if (![...room.players.values()].some((candidate) => candidate.connected)) {
      this.scheduleCleanup(room);
    }
  }
  setReady(userId, ready) {
    const room = this.requireRoom(userId);
    if (room.phase !== "lobby") throw conflict("INVALID_PHASE", "Ready state can only change in the lobby.");
    const player = this.requirePlayer(room, userId);
    player.ready = ready;
    this.emitRoomState(room);
  }
  async startGame(userId) {
    const room = this.requireRoom(userId);
    if (room.ownerId !== userId) throw forbidden("Only the room owner can start the game.");
    if (room.phase !== "lobby") throw conflict("INVALID_PHASE", "The game has already started.");
    const connected = [...room.players.values()].filter((player) => player.connected);
    if (connected.length < 2) throw conflict("NOT_ENOUGH_PLAYERS", "You need at least two connected players.");
    if (!connected.every((player) => player.ready)) throw conflict("NOT_READY", "Every connected player must be ready.");
    room.phase = "roundEnd";
    room.roundNumber = 0;
    room.gameOver = null;
    room.lastRound = null;
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.turnOrder = connected.sort((a, b) => a.joinedAt - b.joinedAt).map((player) => player.userId);
    for (const player of room.players.values()) {
      player.score = 0;
      player.correctGuesses = 0;
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.ready = false;
    }
    const session = await GameSession.create({
      roomId: room.dbId,
      roomCode: room.code,
      players: connected.map((player) => ({
        userId: new Types.ObjectId(player.userId),
        username: player.username,
        score: 0,
        correctGuesses: 0,
        joinedAt: player.joinedAt
      })),
      status: "active",
      startedAt: /* @__PURE__ */ new Date()
    });
    room.sessionId = session._id;
    const message = systemMessage("The game begins. Good luck, stargazers!");
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    gameLog.info({ roomId: room.id, sessionId: session._id.toString(), players: connected.length }, "Game started");
    await this.beginRound(room);
  }
  async playAgain(userId) {
    const room = this.requireRoom(userId);
    if (room.ownerId !== userId) throw forbidden("Only the room owner can start another game.");
    if (room.phase !== "gameOver") throw conflict("INVALID_PHASE", "The game is not over yet.");
    this.clearRoundTimers(room);
    room.phase = "lobby";
    room.roundNumber = 0;
    room.currentDrawerId = null;
    room.lastDrawerId = null;
    room.roundStartedAt = null;
    room.roundEndsAt = null;
    room.secretWord = "";
    room.revealedPositions.clear();
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.lastRound = null;
    room.gameOver = null;
    room.sessionId = null;
    room.turnOrder = [];
    for (const player of room.players.values()) {
      player.score = 0;
      player.correctGuesses = 0;
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.ready = false;
    }
    const message = systemMessage("The room is back in the lobby. Ready up for another game.");
    room.chat.push(message);
    this.broadcastChat(room, message);
    this.emitRoomState(room);
  }
  getState(userId) {
    const room = this.requireRoom(userId);
    return this.getRoomState(room, userId);
  }
  async submitGuess(userId, rawGuess) {
    const room = this.requireRoom(userId);
    const player = this.requirePlayer(room, userId);
    if (room.phase !== "round" || !room.currentDrawerId) {
      throw conflict("NO_ACTIVE_ROUND", "There is no active round to guess in.");
    }
    if (room.currentDrawerId === userId) throw forbidden("The drawer cannot guess their own word.");
    if (player.guessedThisRound) throw conflict("ALREADY_GUESSED", "You already guessed this round.");
    if (player.guessCount >= GUESS_LIMITS.attemptsPerRound) {
      throw tooManyRequests("You have used all guesses for this round.");
    }
    const now = Date.now();
    if (now - player.lastGuessAt < GUESS_LIMITS.cooldownMs) {
      throw tooManyRequests("Guesses are limited to one per second.", GUESS_LIMITS.cooldownMs);
    }
    player.lastGuessAt = now;
    player.guessCount += 1;
    if (room.roundEndsAt == null || now >= room.roundEndsAt) {
      void this.finishRound(room, "timeout");
      throw conflict("ROUND_ENDED", "Time is up for this round.");
    }
    const normalized = normalizeGuess(rawGuess);
    if (normalized !== normalizeGuess(room.secretWord)) {
      this.recordGuess(room, player, rawGuess, false, 0);
      this.emitGuessFeed(room);
      return { correct: false, points: 0, allGuessed: false };
    }
    const remainingMs = Math.max(0, room.roundEndsAt - now);
    const points = calculatePoints(remainingMs);
    player.guessedThisRound = true;
    player.score += points;
    player.roundPoints += points;
    player.correctGuesses += 1;
    this.recordGuess(room, player, rawGuess, true, points);
    const allGuessed = this.allEligibleGuessed(room);
    if (allGuessed) this.revealGuesses(room);
    await this.persistGuess(room, player, points, remainingMs);
    this.emitGuessFeed(room);
    this.emitToRoom(room, "score:updated", { leaderboard: this.leaderboard(room) });
    this.emitRoomState(room);
    if (allGuessed) {
      setImmediate(() => void this.finishRound(room, "allGuessed"));
    }
    return { correct: true, points, allGuessed };
  }
  submitChat(userId, text) {
    const room = this.requireRoom(userId);
    const player = this.requirePlayer(room, userId);
    if (player.mutedUntil != null && player.mutedUntil > Date.now()) {
      throw forbidden("You are muted in this room.");
    }
    const now = Date.now();
    if (now - player.lastChatAt < CHAT_LIMITS.cooldownMs) {
      throw tooManyRequests("You are sending messages too quickly.", CHAT_LIMITS.cooldownMs);
    }
    player.lastChatAt = now;
    const message = {
      id: randomId(8),
      kind: "player",
      userId,
      username: player.username,
      text,
      createdAt: now
    };
    room.chat.push(message);
    this.trimChat(room);
    room.lastActivityAt = now;
    this.broadcastChat(room, message);
    return message;
  }
  addStroke(userId, socketId, stroke) {
    const room = this.requireRoom(userId);
    if (room.phase !== "round") throw conflict("NO_ACTIVE_ROUND", "Drawing is only available during a round.");
    if (room.currentDrawerId !== userId) throw forbidden("Only the active drawer can draw.");
    if (room.activeStroke && room.activeStroke.strokeId !== stroke.id) {
      room.activeStroke = null;
    }
    if (room.activeStroke && room.activeStroke.socketId !== socketId) {
      throw conflict("STROKE_IN_PROGRESS", "Another stroke is already in progress.");
    }
    const existing = room.strokes.find((candidate) => candidate.id === stroke.id);
    if (!existing) {
      if (room.strokes.length >= DRAWING_LIMITS.maxStrokes) {
        throw conflict("CANVAS_FULL", "The canvas is full. Clear it to continue.");
      }
      const created = {
        id: stroke.id,
        color: stroke.color,
        width: stroke.width,
        tool: stroke.tool,
        points: [...stroke.points]
      };
      room.strokes.push(created);
      room.strokePointCount += created.points.length;
      room.activeStroke = { socketId, strokeId: stroke.id };
      room.redoStack = [];
    } else {
      if (existing.color !== stroke.color || existing.width !== stroke.width || existing.tool !== stroke.tool) {
        throw badRequest("STROKE_MISMATCH", "Stroke settings cannot change mid-stroke.");
      }
      if (room.activeStroke?.strokeId === stroke.id && room.activeStroke.socketId !== socketId) {
        throw forbidden("You cannot extend another player's stroke.");
      }
      if (room.strokePointCount + stroke.points.length > DRAWING_LIMITS.maxCanvasPoints) {
        throw conflict("CANVAS_FULL", "The canvas reached its size limit. Clear it to continue.");
      }
      existing.points.push(...stroke.points);
      room.strokePointCount += stroke.points.length;
      room.activeStroke = { socketId, strokeId: stroke.id };
    }
    room.lastActivityAt = Date.now();
    const event = existing ?? room.strokes[room.strokes.length - 1];
    this.io?.to(roomChannel(room.id)).except(socketId).emit("drawing:stroke", {
      ...event,
      points: stroke.points
    });
  }
  endStroke(userId, strokeId) {
    const room = this.requireRoom(userId);
    if (room.currentDrawerId !== userId) throw forbidden("Only the active drawer can draw.");
    if (room.activeStroke?.strokeId === strokeId) room.activeStroke = null;
  }
  undoStroke(userId) {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    if (room.strokes.length === 0) throw conflict("NOTHING_TO_UNDO", "There is nothing to undo.");
    if (room.redoStack.length >= DRAWING_LIMITS.maxUndoDepth) room.redoStack.shift();
    const removed = room.strokes.pop();
    if (!removed) return;
    room.strokePointCount -= removed.points.length;
    room.redoStack.push(removed);
    room.activeStroke = null;
    this.broadcastDrawingSync(room);
  }
  redoStroke(userId) {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    const restored = room.redoStack.pop();
    if (!restored) throw conflict("NOTHING_TO_REDO", "There is nothing to redo.");
    if (room.strokes.length >= DRAWING_LIMITS.maxStrokes) throw conflict("CANVAS_FULL", "The canvas is full.");
    if (room.strokePointCount + restored.points.length > DRAWING_LIMITS.maxCanvasPoints) {
      room.redoStack.push(restored);
      throw conflict("CANVAS_FULL", "The canvas reached its size limit.");
    }
    room.strokes.push(restored);
    room.strokePointCount += restored.points.length;
    room.activeStroke = null;
    this.broadcastDrawingSync(room);
  }
  clearDrawing(userId) {
    const room = this.requireRoom(userId);
    this.assertDrawer(room, userId);
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    this.io?.to(roomChannel(room.id)).emit("drawing:clear", {});
    this.emitRoomState(room);
  }
  async moderationAction(actorId, action, targetId) {
    const room = this.requireRoom(actorId);
    if (room.ownerId !== actorId) throw forbidden("Only the room owner can moderate players.");
    if (actorId === targetId) throw badRequest("INVALID_TARGET", "You cannot moderate yourself.");
    const target = room.players.get(targetId);
    if (!target) throw notFound("That player is not in this room.");
    if (action === "kick") {
      await ModerationRecord.create({
        kind: "kick",
        roomCode: room.code,
        actorId: new Types.ObjectId(actorId),
        targetId: new Types.ObjectId(targetId),
        reason: "Removed by room owner"
      });
      const targetSocketId = target.socketId;
      this.appendSystemMessage(room, `${target.username} was removed by the room owner.`);
      await this.leaveRoom(targetId, "kick");
      if (targetSocketId) {
        const targetSocket = this.io?.sockets.sockets.get(targetSocketId);
        targetSocket?.emit("error", { code: "KICKED", message: "The room owner removed you from the room." });
        targetSocket?.disconnect(true);
      }
      securityLog.info({ roomId: room.id, actorId, targetId, action }, "Moderation action applied");
      return;
    }
    target.mutedUntil = action === "mute" ? Date.now() + MUTE_DURATION_MS : null;
    await ModerationRecord.create({
      kind: action,
      roomCode: room.code,
      actorId: new Types.ObjectId(actorId),
      targetId: new Types.ObjectId(targetId),
      reason: action === "mute" ? "Muted by room owner" : "Unmuted by room owner"
    });
    this.appendSystemMessage(
      room,
      `${target.username} was ${action === "mute" ? "muted for five minutes" : "unmuted"}.`
    );
    this.emitRoomState(room);
    securityLog.info({ roomId: room.id, actorId, targetId, action }, "Moderation action applied");
  }
  async reportPlayer(actorId, targetId, reason) {
    const room = this.requireRoom(actorId);
    if (actorId === targetId) throw badRequest("INVALID_TARGET", "You cannot report yourself.");
    if (!room.players.has(targetId)) throw notFound("That player is not in this room.");
    await ModerationRecord.create({
      kind: "report",
      roomCode: room.code,
      actorId: new Types.ObjectId(actorId),
      targetId: new Types.ObjectId(targetId),
      reason
    });
    securityLog.warn({ roomId: room.id, actorId, targetId }, "Player report filed");
  }
  async beginRound(room) {
    if (room.phase === "gameOver") return;
    const connected = [...room.players.values()].filter((player) => player.connected);
    if (connected.length < 2) {
      await this.finishGame(room);
      return;
    }
    const nextDrawer = this.chooseNextDrawer(room);
    if (!nextDrawer) {
      await this.finishGame(room);
      return;
    }
    const drawablePlayers = connected.filter((player) => player.userId !== nextDrawer.userId);
    if (drawablePlayers.length === 0) {
      await this.finishGame(room);
      return;
    }
    this.clearRoundTimers(room);
    room.roundNumber += 1;
    room.phase = "round";
    room.currentDrawerId = nextDrawer.userId;
    room.lastDrawerId = nextDrawer.userId;
    room.roundStartedAt = Date.now();
    room.roundEndsAt = room.roundStartedAt + room.roundDurationSeconds * 1e3;
    room.roundToken += 1;
    room.secretWord = pickWord();
    room.revealedPositions = /* @__PURE__ */ new Set();
    room.hintStage = 0;
    room.strokes = [];
    room.strokePointCount = 0;
    room.redoStack = [];
    room.activeStroke = null;
    room.maskedGuesses = [];
    room.lastRound = null;
    room.lastActivityAt = Date.now();
    for (const player of room.players.values()) {
      player.guessedThisRound = false;
      player.roundPoints = 0;
      player.guessCount = 0;
      player.lastGuessAt = 0;
      player.ready = false;
    }
    const token = room.roundToken;
    room.roundTimer = setTimeout(() => {
      if (room.roundToken === token) void this.finishRound(room, "timeout");
    }, room.roundDurationSeconds * 1e3 + 20);
    room.roundTimer.unref?.();
    const initialHint = this.hint(room);
    for (const player of room.players.values()) {
      const socket = player.socketId ? this.io?.sockets.sockets.get(player.socketId) : null;
      if (!socket) continue;
      const payload = {
        roundNumber: room.roundNumber,
        drawerId: room.currentDrawerId,
        drawerName: nextDrawer.username,
        endsAt: room.roundEndsAt,
        serverNow: Date.now(),
        hint: initialHint,
        ...player.userId === room.currentDrawerId ? { word: room.secretWord } : {}
      };
      socket.emit("game:roundStarted", payload);
    }
    const message = systemMessage(
      `Round ${room.roundNumber} of ${room.totalRounds}: ${nextDrawer.username} is drawing.`
    );
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
    this.emitRoomState(room);
    this.emitTimer(room);
    gameLog.info(
      { roomId: room.id, roomCode: room.code, round: room.roundNumber, drawerId: nextDrawer.userId },
      "Round started"
    );
  }
  async finishRound(room, reason) {
    if (room.phase !== "round") return;
    room.phase = "roundEnd";
    room.roundToken += 1;
    this.clearRoundTimers(room);
    room.roundEndsAt = null;
    room.activeStroke = null;
    const summary = this.makeRoundSummary(room, reason);
    room.lastRound = summary;
    this.emitToRoom(room, "game:roundEnded", summary);
    this.emitToRoom(room, "leaderboard:updated", { leaderboard: this.leaderboard(room) });
    await this.persistRound(room, summary);
    this.emitRoomState(room);
    if (room.roundNumber >= room.totalRounds) {
      await this.finishGame(room);
      return;
    }
    room.nextRoundTimer = setTimeout(() => {
      void this.beginRound(room);
    }, ROUND_END_DELAY_MS);
    room.nextRoundTimer.unref?.();
  }
  async finishGame(room) {
    if (room.phase === "gameOver") return;
    this.clearRoundTimers(room);
    room.phase = "gameOver";
    room.currentDrawerId = null;
    room.roundEndsAt = null;
    room.activeStroke = null;
    const standings = this.leaderboard(room);
    const winner = standings[0];
    if (!winner) {
      await this.closeRoom(room, "no-players");
      return;
    }
    room.gameOver = {
      winnerId: winner.userId,
      winnerName: winner.username,
      standings
    };
    if (room.sessionId) {
      const sessionId = room.sessionId;
      const finished = await GameSession.findOneAndUpdate(
        { _id: sessionId, status: "active" },
        {
          $set: {
            status: "finished",
            winnerId: new Types.ObjectId(winner.userId),
            winnerName: winner.username,
            endedAt: /* @__PURE__ */ new Date(),
            players: [...room.players.values()].map((player) => ({
              userId: new Types.ObjectId(player.userId),
              username: player.username,
              score: player.score,
              correctGuesses: player.correctGuesses,
              joinedAt: player.joinedAt
            }))
          }
        },
        { returnDocument: "after" }
      );
      if (finished) {
        await this.applyGameStats(room, winner.userId);
      }
    }
    const message = systemMessage(`${winner.username} wins the game with ${winner.score} points!`);
    room.chat.push(message);
    this.broadcastChat(room, message);
    this.emitToRoom(room, "game:over", room.gameOver);
    this.emitRoomState(room);
    gameLog.info({ roomId: room.id, winnerId: winner.userId, score: winner.score }, "Game finished");
  }
  async applyGameStats(room, winnerId) {
    try {
      const players = [...room.players.values()];
      await Promise.all(
        players.map(
          (player) => User.updateOne(
            { _id: player.userId },
            {
              $inc: {
                "stats.gamesPlayed": 1,
                ...player.userId === winnerId ? { "stats.wins": 1 } : {}
              }
            }
          )
        )
      );
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, "Failed to persist game-level statistics");
    }
  }
  async persistGuess(room, player, points, remainingMs) {
    if (!room.sessionId) return;
    try {
      const result = await GameResult.updateOne(
        {
          sessionId: room.sessionId,
          roundNumber: room.roundNumber,
          userId: new Types.ObjectId(player.userId)
        },
        {
          $setOnInsert: {
            sessionId: room.sessionId,
            roomCode: room.code,
            roundNumber: room.roundNumber,
            userId: new Types.ObjectId(player.userId),
            username: player.username,
            points,
            remainingMs,
            guessedAt: /* @__PURE__ */ new Date(),
            appliedToUser: false
          }
        },
        { upsert: true }
      );
      if (result.upsertedCount === 1) {
        await User.updateOne(
          { _id: player.userId },
          { $inc: { "stats.correctGuesses": 1, "stats.totalPoints": points } }
        );
        await GameResult.updateOne(
          { sessionId: room.sessionId, roundNumber: room.roundNumber, userId: player.userId },
          { $set: { appliedToUser: true } }
        );
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id, userId: player.userId }, "Failed to persist score result");
    }
  }
  async persistRound(room, summary) {
    if (!room.sessionId) return;
    try {
      await GameSession.updateOne(
        { _id: room.sessionId, status: "active" },
        {
          $set: {
            roundsPlayed: room.roundNumber,
            players: [...room.players.values()].map((player) => ({
              userId: new Types.ObjectId(player.userId),
              username: player.username,
              score: player.score,
              correctGuesses: player.correctGuesses,
              joinedAt: player.joinedAt
            }))
          }
        }
      );
    } catch (error) {
      logger.error({ err: error, roomId: room.id, round: summary.roundNumber }, "Failed to persist round");
    }
  }
  makeRoundSummary(room, reason) {
    const drawer = room.currentDrawerId ? room.players.get(room.currentDrawerId) : void 0;
    const results = [...room.players.values()].filter((player) => player.guessedThisRound).sort((a, b) => b.roundPoints - a.roundPoints || a.joinedAt - b.joinedAt).map((player) => ({
      userId: player.userId,
      username: player.username,
      points: player.roundPoints,
      correctGuesses: player.correctGuesses
    }));
    return {
      roundNumber: room.roundNumber,
      drawerId: drawer?.userId ?? "",
      drawerName: drawer?.username ?? "Unknown",
      word: room.secretWord,
      reason,
      results
    };
  }
  recordGuess(room, player, text, correct, points) {
    room.maskedGuesses.push({
      id: randomId(8),
      roundNumber: room.roundNumber,
      userId: player.userId,
      username: player.username,
      text,
      correct,
      points,
      createdAt: Date.now(),
      revealed: false
    });
    if (room.maskedGuesses.length > MAX_GUESS_FEED) {
      room.maskedGuesses = room.maskedGuesses.slice(-MAX_GUESS_FEED);
    }
  }
  /** Raw guess text becomes visible only once every eligible guesser has guessed. */
  revealGuesses(room) {
    for (const guess of room.maskedGuesses) {
      if (guess.roundNumber === room.roundNumber) guess.revealed = true;
    }
  }
  guessFeed(room) {
    const guesses = room.maskedGuesses.map((guess) => ({
      id: guess.id,
      roundNumber: guess.roundNumber,
      userId: guess.userId,
      username: guess.username,
      masked: maskGuess(guess.text),
      text: guess.revealed ? guess.text : null,
      correct: guess.correct,
      points: guess.points,
      createdAt: guess.createdAt,
      revealed: guess.revealed
    }));
    return { roundNumber: room.roundNumber, guesses };
  }
  emitGuessFeed(room) {
    this.emitToRoom(room, "guess:masked", this.guessFeed(room));
  }
  allEligibleGuessed(room) {
    return [...room.players.values()].filter((player) => player.connected && player.userId !== room.currentDrawerId).every((player) => player.guessedThisRound);
  }
  chooseNextDrawer(room) {
    const connectedOrder = room.turnOrder.filter((userId) => room.players.get(userId)?.connected);
    for (const player of room.players.values()) {
      if (player.connected && !connectedOrder.includes(player.userId)) connectedOrder.push(player.userId);
    }
    if (connectedOrder.length === 0) return null;
    const lastIndex = room.lastDrawerId ? connectedOrder.indexOf(room.lastDrawerId) : -1;
    for (let offset = 1; offset <= connectedOrder.length; offset += 1) {
      const candidateId = connectedOrder[(lastIndex + offset) % connectedOrder.length];
      if (!candidateId) continue;
      const candidate = room.players.get(candidateId);
      if (candidate?.connected) return candidate;
    }
    return null;
  }
  tick() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.phase === "round" && room.roundEndsAt != null) {
        if (now >= room.roundEndsAt) {
          void this.finishRound(room, "timeout");
          continue;
        }
        this.updateHints(room, now);
        this.emitTimer(room);
      }
      if (room.players.size === 0 || now - room.lastActivityAt > ROOM_MAX_AGE_MS) {
        void this.closeRoom(room, "stale");
        continue;
      }
      if (this.isRoomEmptyAndExpired(room, now)) {
        void this.closeRoom(room, "empty");
      }
    }
  }
  updateHints(room, now) {
    if (room.roundStartedAt == null || room.roundEndsAt == null) return;
    const total = room.roundEndsAt - room.roundStartedAt;
    const elapsed = now - room.roundStartedAt;
    const ratio = elapsed / total;
    const desired = ratio >= 0.66 ? 3 : ratio >= 0.33 ? 1 : 0;
    if (desired <= room.hintStage) return;
    room.hintStage = desired;
    room.revealedPositions = revealHintPositions(room.secretWord, room.revealedPositions, desired);
    const hint = this.hint(room);
    this.emitToRoom(room, "game:hint", hint);
    this.emitRoomState(room);
  }
  hint(room) {
    const letters = [...room.secretWord].filter((character) => /[a-z]/i.test(character)).length;
    return {
      masked: maskWord(room.secretWord, room.revealedPositions),
      revealedPositions: [...room.revealedPositions].sort((a, b) => a - b),
      length: room.secretWord.length,
      lettersRemaining: Math.max(0, letters - room.revealedPositions.size)
    };
  }
  emitTimer(room) {
    if (room.phase !== "round" || room.roundEndsAt == null) return;
    const now = Date.now();
    this.emitToRoom(room, "game:timerUpdate", {
      roundNumber: room.roundNumber,
      endsAt: room.roundEndsAt,
      serverNow: now,
      remainingMs: Math.max(0, room.roundEndsAt - now)
    });
  }
  getRoomState(room, viewerId) {
    const drawer = room.currentDrawerId ? room.players.get(room.currentDrawerId) : void 0;
    const leaderboard = this.leaderboard(room);
    const isDrawer = room.phase === "round" && room.currentDrawerId === viewerId;
    const hint = room.phase === "round" || room.phase === "roundEnd" ? isDrawer ? null : this.hint(room) : null;
    const connected = [...room.players.values()].filter((player) => player.connected);
    const canStart = room.phase === "lobby" && room.ownerId === viewerId && connected.length >= 2 && connected.every((player) => player.ready);
    return {
      id: room.id,
      code: room.code,
      name: room.name,
      visibility: room.visibility,
      ownerId: room.ownerId,
      maxPlayers: room.maxPlayers,
      roundDurationSeconds: room.roundDurationSeconds,
      totalRounds: room.totalRounds,
      phase: room.phase,
      roundNumber: room.roundNumber,
      currentDrawerId: room.currentDrawerId,
      currentDrawerName: drawer?.username ?? null,
      roundEndsAt: room.roundEndsAt,
      serverNow: Date.now(),
      word: isDrawer ? room.secretWord : null,
      hint,
      players: [...room.players.values()].map((player) => publicPlayer(player, room.ownerId)),
      leaderboard,
      chat: room.chat,
      maskedGuesses: this.guessFeed(room).guesses,
      lastRound: room.lastRound,
      gameOver: room.gameOver,
      canStart,
      strokes: room.phase === "lobby" ? [] : room.strokes,
      canDraw: isDrawer,
      canUndo: isDrawer && room.strokes.length > 0,
      canRedo: isDrawer && room.redoStack.length > 0
    };
  }
  leaderboard(room) {
    return toLeaderboard(
      [...room.players.values()].map((player) => ({
        userId: player.userId,
        username: player.username,
        score: player.score,
        correctGuesses: player.correctGuesses,
        joinedAt: player.joinedAt,
        connected: player.connected
      }))
    );
  }
  emitRoomState(room) {
    for (const player of room.players.values()) {
      if (!player.socketId) continue;
      const socket = this.io?.sockets.sockets.get(player.socketId);
      socket?.emit("room:state", this.getRoomState(room, player.userId));
    }
  }
  emitToRoom(room, event, payload) {
    this.io?.to(roomChannel(room.id)).emit(event, payload);
  }
  broadcastChat(room, message) {
    this.emitToRoom(room, "chat:message", message);
  }
  appendSystemMessage(room, text) {
    const message = systemMessage(text);
    room.chat.push(message);
    this.trimChat(room);
    this.broadcastChat(room, message);
  }
  trimChat(room) {
    if (room.chat.length > CHAT_LIMITS.maxHistory) {
      room.chat = room.chat.slice(-CHAT_LIMITS.maxHistory);
    }
  }
  broadcastDrawingSync(room) {
    this.emitToRoom(room, "drawing:sync", { strokes: room.strokes });
    this.emitRoomState(room);
  }
  assertDrawer(room, userId) {
    if (room.phase !== "round") throw conflict("NO_ACTIVE_ROUND", "There is no active round.");
    if (room.currentDrawerId !== userId) throw forbidden("Only the active drawer can do that.");
  }
  requireRoom(userId) {
    const roomId = this.userRooms.get(userId);
    const room = roomId ? this.rooms.get(roomId) : null;
    if (!room) throw forbidden("You are not in a room.");
    return room;
  }
  getRoomForUser(userId) {
    const roomId = this.userRooms.get(userId);
    return roomId ? this.rooms.get(roomId) ?? null : null;
  }
  requirePlayer(room, userId) {
    const player = room.players.get(userId);
    if (!player) throw forbidden("You are not a member of this room.");
    return player;
  }
  transferOwnership(room) {
    const nextOwner = [...room.players.values()].filter((player) => player.connected).sort((a, b) => a.joinedAt - b.joinedAt)[0];
    if (nextOwner) {
      room.ownerId = nextOwner.userId;
      this.appendSystemMessage(room, `${nextOwner.username} is now the room owner.`);
    }
  }
  scheduleCleanup(room) {
    this.cancelCleanup(room);
    room.cleanupTimer = setTimeout(() => {
      const current = this.rooms.get(room.id);
      if (current && ![...current.players.values()].some((player) => player.connected)) {
        void this.closeRoom(current, "empty");
      }
    }, EMPTY_ROOM_TTL_MS);
    room.cleanupTimer.unref?.();
  }
  cancelCleanup(room) {
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    room.cleanupTimer = null;
  }
  cancelDrawerDisconnect(room) {
    if (room.drawerDisconnectTimer) clearTimeout(room.drawerDisconnectTimer);
    room.drawerDisconnectTimer = null;
  }
  cancelOwnerTransfer(room) {
    if (room.ownerTransferTimer) clearTimeout(room.ownerTransferTimer);
    room.ownerTransferTimer = null;
  }
  clearRoundTimers(room) {
    if (room.roundTimer) clearTimeout(room.roundTimer);
    if (room.nextRoundTimer) clearTimeout(room.nextRoundTimer);
    if (room.drawerDisconnectTimer) clearTimeout(room.drawerDisconnectTimer);
    room.roundTimer = null;
    room.nextRoundTimer = null;
    room.drawerDisconnectTimer = null;
    room.roundToken += 1;
  }
  clearTimers(room) {
    this.clearRoundTimers(room);
    this.cancelCleanup(room);
    this.cancelOwnerTransfer(room);
  }
  isRoomEmptyAndExpired(room, now) {
    return room.players.size === 0 || ![...room.players.values()].some((player) => player.connected) && now - room.lastActivityAt > EMPTY_ROOM_TTL_MS;
  }
  async closeRoom(room, reason) {
    if (!this.rooms.has(room.id)) return;
    this.clearTimers(room);
    this.rooms.delete(room.id);
    for (const player of room.players.values()) {
      if (this.userRooms.get(player.userId) === room.id) this.userRooms.delete(player.userId);
      if (player.socketId) {
        const socket = this.io?.sockets.sockets.get(player.socketId);
        socket?.leave(roomChannel(room.id));
        socket?.emit("system:message", {
          id: randomId(8),
          text: "This room has closed.",
          createdAt: Date.now()
        });
      }
    }
    try {
      await GameRoom.updateOne({ _id: room.dbId }, { $set: { status: "closed", closedAt: /* @__PURE__ */ new Date() } });
      if (room.sessionId) {
        await GameSession.updateOne(
          { _id: room.sessionId, status: "active" },
          { $set: { status: "abandoned", endedAt: /* @__PURE__ */ new Date() } }
        );
      }
    } catch (error) {
      logger.error({ err: error, roomId: room.id }, "Failed to close room records");
    }
    gameLog.info({ roomId: room.id, reason }, "Room closed");
  }
}
export {
  GameHub
};
