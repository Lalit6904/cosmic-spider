import { Schema, model } from "mongoose";
const passwordResetTokenSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    usedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
const PasswordResetToken = model("PasswordResetToken", passwordResetTokenSchema);
export {
  PasswordResetToken
};
