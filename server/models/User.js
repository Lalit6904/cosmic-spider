import { Schema, model } from "mongoose";
const statsSchema = new Schema(
  {
    gamesPlayed: { type: Number, default: 0, min: 0 },
    wins: { type: Number, default: 0, min: 0 },
    correctGuesses: { type: Number, default: 0, min: 0 },
    totalPoints: { type: Number, default: 0, min: 0 }
  },
  { _id: false }
);
const userSchema = new Schema(
  {
    username: { type: String, required: true, trim: true, maxlength: 20 },
    usernameLower: { type: String, required: true, unique: true, index: true, select: false },
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254, select: false },
    emailLower: { type: String, required: true, unique: true, index: true, select: false },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    stats: { type: statsSchema, default: () => ({}) },
    failedLoginAttempts: { type: Number, default: 0, min: 0, select: false },
    lockUntil: { type: Date, default: null, select: false }
  },
  { timestamps: true }
);
userSchema.index({ "stats.totalPoints": -1, "stats.wins": -1, "stats.correctGuesses": -1, usernameLower: 1 });
const User = model("User", userSchema);
export {
  User
};
