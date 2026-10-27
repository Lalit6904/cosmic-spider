import { Schema, model } from "mongoose";
const sessionPlayerSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    username: { type: String, required: true, maxlength: 20 },
    score: { type: Number, default: 0, min: 0 },
    correctGuesses: { type: Number, default: 0, min: 0 },
    joinedAt: { type: Number, required: true }
  },
  { _id: false }
);
const gameSessionSchema = new Schema(
  {
    roomId: { type: Schema.Types.ObjectId, ref: "GameRoom", required: true, index: true },
    roomCode: { type: String, required: true, maxlength: 8 },
    players: { type: [sessionPlayerSchema], default: [] },
    roundsPlayed: { type: Number, default: 0, min: 0 },
    winnerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    winnerName: { type: String, default: null },
    status: { type: String, enum: ["active", "finished", "abandoned"], default: "active", index: true },
    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
gameSessionSchema.index({ "players.userId": 1, createdAt: -1 });
const GameSession = model("GameSession", gameSessionSchema);
export {
  GameSession
};
