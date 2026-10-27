import { Schema, model } from "mongoose";
const moderationRecordSchema = new Schema(
  {
    kind: { type: String, enum: ["report", "mute", "unmute", "kick"], required: true, index: true },
    roomCode: { type: String, required: true, maxlength: 8 },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    targetId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    reason: { type: String, maxlength: 500, default: "" },
    createdAt: { type: Date, default: Date.now, index: true }
  },
  { timestamps: false }
);
moderationRecordSchema.index({ createdAt: -1 });
const ModerationRecord = model("ModerationRecord", moderationRecordSchema);
export {
  ModerationRecord
};
