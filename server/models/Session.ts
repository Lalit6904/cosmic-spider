import { Schema, model, type InferSchemaType } from 'mongoose';

const sessionSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    csrfHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: { expires: 0 } },
    lastSeenAt: { type: Date, default: Date.now },
    userAgent: { type: String, maxlength: 300, default: '' },
  },
  { timestamps: true },
);

export type SessionDocument = InferSchemaType<typeof sessionSchema> & { _id: import('mongoose').Types.ObjectId };
export const Session = model('Session', sessionSchema);
