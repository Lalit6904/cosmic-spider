import { afterAll, afterEach, beforeAll } from "vitest";
import { existsSync } from "node:fs";
import { MongoMemoryServer } from "mongodb-memory-server";
process.env.NODE_ENV = "test";
process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/cosmic_spider_test";
process.env.ALLOWED_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
process.env.LOG_LEVEL = "silent";
process.env.SESSION_COOKIE_NAME ??= "cs_session";
process.env.SESSION_TTL_DAYS ??= "7";
process.env.SECURE_COOKIES = "false";
process.env.TRUST_PROXY = "false";
const windowsMongod = "C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe";
let memoryServer;
beforeAll(async () => {
  const configuredBinary = process.env.MONGOMS_SYSTEM_BINARY;
  const systemBinary = configuredBinary ?? (existsSync(windowsMongod) ? windowsMongod : void 0);
  memoryServer = await MongoMemoryServer.create({
    ...systemBinary ? { binary: { systemBinary } } : {}
  });
  process.env.MONGODB_URI = memoryServer.getUri("cosmic_spider_test");
  const { connectDatabase } = await import("../server/db/connect.js");
  await connectDatabase(process.env.MONGODB_URI);
  const mongoose = (await import("mongoose")).default;
  await Promise.all([
    import("../server/models/User.js"),
    import("../server/models/Session.js"),
    import("../server/models/PasswordResetToken.js"),
    import("../server/models/GameRoom.js"),
    import("../server/models/GameSession.js"),
    import("../server/models/GameResult.js"),
    import("../server/models/ModerationRecord.js")
  ]);
  const models = Object.values(mongoose.models);
  await Promise.all(models.map((model) => model.syncIndexes()));
});
afterEach(async () => {
  const mongoose = (await import("mongoose")).default;
  const collections = await mongoose.connection.db?.collections();
  if (collections) {
    await Promise.all(collections.map((collection) => collection.deleteMany({})));
  }
  const { resetHttpRateLimits } = await import("../server/middleware/security.js");
  resetHttpRateLimits();
});
afterAll(async () => {
  const mongoose = (await import("mongoose")).default;
  await mongoose.disconnect();
  await memoryServer?.stop();
});
