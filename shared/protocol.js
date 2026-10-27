const ROOM_LIMITS = {
  minPlayers: 2,
  maxPlayers: 12,
  minRoundSeconds: 30,
  maxRoundSeconds: 180,
  minRounds: 1,
  maxRounds: 20
};
const DRAWING_LIMITS = {
  maxEventsPerSecond: 45,
  maxPointsPerEvent: 64,
  maxCanvasPoints: 12e3,
  maxStrokes: 600,
  maxUndoDepth: 40,
  maxPayloadBytes: 96 * 1024
};
const CHAT_LIMITS = {
  maxLength: 280,
  maxHistory: 100,
  messagesPerTenSeconds: 6,
  cooldownMs: 900
};
const GUESS_LIMITS = {
  maxLength: 64,
  attemptsPerRound: 30,
  cooldownMs: 700
};
export {
  CHAT_LIMITS,
  DRAWING_LIMITS,
  GUESS_LIMITS,
  ROOM_LIMITS
};
