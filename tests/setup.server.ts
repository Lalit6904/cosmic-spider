import { afterAll, afterEach, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/cosmic_spider_test';
process.env.ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173';
process.env.LOG_LEVEL = 'silent';
process.env.SESSION_COOKIE_NAME ??= 'cs_session';
process.env.SESSION_TTL_DAYS ??= '7';
process.env.SECURE_COOKIES = 'false';
process.env.TRUST_PROXY = 'false';

const windowsMongod = 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';

let memoryServer: MongoMemoryServer;

beforeAll(async () => {
  const configuredBinary = process.env.MONGOMS_SYSTEM_BINARY;
  const systemBinary =
    configuredBinary ?? (existsSync(windowsMongod) ? windowsMongod : undefined);

  memoryServer = await MongoMemoryServer.create({
    ...(systemBinary ? { binary: { systemBinary } } : {}),
  });
  process.env.MONGODB_URI = memoryServer.getUri('cosmic_spider_test');

  // Connect through the production helper so tests exercise the same Mongoose
  // settings (strictQuery, pooling) as the running server.
  const { connectDatabase } = await import('../server/db/connect');
  await connectDatabase(process.env.MONGODB_URI);
  const mongoose = (await import('mongoose')).default;

  // Register every model and make sure unique indexes (notably the duplicate
  // scoring index) exist before tests exercise concurrency paths.
  await Promise.all([
    import('../server/models/User'),
    import('../server/models/Session'),
    import('../server/models/PasswordResetToken'),
    import('../server/models/GameRoom'),
    import('../server/models/GameSession'),
    import('../server/models/GameResult'),
    import('../server/models/ModerationRecord'),
  ]);
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.syncIndexes()));
});

afterEach(async () => {
  const mongoose = (await import('mongoose')).default;
  const collections = await mongoose.connection.db?.collections();
  if (collections) {
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  }
  const { resetHttpRateLimits } = await import('../server/middleware/security');
  resetHttpRateLimits();
});

afterAll(async () => {
  const mongoose = (await import('mongoose')).default;
  await mongoose.disconnect();
  await memoryServer?.stop();
});
