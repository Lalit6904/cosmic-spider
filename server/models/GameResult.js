import { Schema, model } from "mongoose";
const gameResultSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: "GameSession", required: true, index: true },
    roomCode: { type: String, required: true, maxlength: 8 },
    roundNumber: { type: Number, required: true, min: 1 },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    username: { type: String, required: true, maxlength: 20 },
    points: { type: Number, required: true, min: 0 },
    remainingMs: { type: Number, required: true, min: 0 },
    guessedAt: { type: Date, required: true },
    appliedToUser: { type: Boolean, default: false, index: true }
  },
  { timestamps: true }
);
gameResultSchema.index({ sessionId: 1, roundNumber: 1, userId: 1 }, { unique: true });
const GameResult = model("GameResult", gameResultSchema);
export {
  GameResult
};
