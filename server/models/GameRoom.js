import { Schema, model } from "mongoose";
const gameRoomSchema = new Schema(
  {
    code: { type: String, required: true, unique: true, index: true, maxlength: 8 },
    name: { type: String, required: true, maxlength: 40 },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    visibility: { type: String, enum: ["public", "private"], required: true },
    maxPlayers: { type: Number, required: true, min: 2, max: 12 },
    roundDurationSeconds: { type: Number, required: true, min: 30, max: 180 },
    totalRounds: { type: Number, required: true, min: 1, max: 20 },
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    closedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
gameRoomSchema.index({ status: 1, updatedAt: -1 });
gameRoomSchema.index({ updatedAt: -1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
const GameRoom = model("GameRoom", gameRoomSchema);
export {
  GameRoom
};
