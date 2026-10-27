import mongoose from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../lib/logger.js";
async function connectDatabase(uri = env.MONGODB_URI) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 1e4,
    maxPoolSize: 20,
    ...env.MONGODB_TLS ? { tls: true } : {}
  });
  logger.info({ database: mongoose.connection.name }, "MongoDB connected");
  return mongoose;
}
async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
async function pingDatabase() {
  if (mongoose.connection.db == null) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
export {
  connectDatabase,
  disconnectDatabase,
  pingDatabase
};
