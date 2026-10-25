import { Schema, model, type InferSchemaType } from 'mongoose';

/**
 * One document per (session, round, user, correct guess). The unique index is
 * the last line of defence against duplicate scoring. `appliedToUser` supports
 * reconciliation if the process stops between result creation and the counter
 * update.
 */
const gameResultSchema = new Schema(
  {
    sessionId: { type: Schema.Types.ObjectId, ref: 'GameSession', required: true, index: true },
    roomCode: { type: String, required: true, maxlength: 8 },
    roundNumber: { type: Number, required: true, min: 1 },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    username: { type: String, required: true, maxlength: 20 },
    points: { type: Number, required: true, min: 0 },
    remainingMs: { type: Number, required: true, min: 0 },
    guessedAt: { type: Date, required: true },
    appliedToUser: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

gameResultSchema.index({ sessionId: 1, roundNumber: 1, userId: 1 }, { unique: true });

export type GameResultDocument = InferSchemaType<typeof gameResultSchema> & {
  _id: import('mongoose').Types.ObjectId;
};
export const GameResult = model('GameResult', gameResultSchema);
