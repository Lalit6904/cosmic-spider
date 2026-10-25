import mongoose from 'mongoose';
import { env } from '../config/env';
import { logger } from '../lib/logger';

export async function connectDatabase(uri = env.MONGODB_URI): Promise<typeof mongoose> {
  mongoose.set('strictQuery', true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    ...(env.MONGODB_TLS ? { tls: true } : {}),
  });
  logger.info({ database: mongoose.connection.name }, 'MongoDB connected');
  return mongoose;
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export async function pingDatabase(): Promise<boolean> {
  if (mongoose.connection.db == null) return false;
  try {
    await mongoose.connection.db.admin().ping();
    return true;
  } catch {
    return false;
  }
}
