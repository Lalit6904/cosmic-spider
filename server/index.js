import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./db/connect.js";
import { GameHub } from "./game/GameHub.js";
import { logger } from "./lib/logger.js";
import { RealtimeService } from "./socket/RealtimeService.js";
async function main() {
  await connectDatabase();
  const hub = new GameHub();
  const app = createApp({ hub });
  const httpServer = createServer(app);
  httpServer.requestTimeout = 3e4;
  httpServer.headersTimeout = 35e3;
  httpServer.keepAliveTimeout = 5e3;
  httpServer.maxRequestsPerSocket = 1e3;
  const realtime = new RealtimeService(httpServer, hub);
  httpServer.listen(env.PORT, env.HOST, () => {
    logger.info(
      { host: env.HOST, port: env.PORT, origins: env.allowedOrigins },
      "Cosmic Spider listening"
    );
  });
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down");
    const forceExit = setTimeout(() => {
      logger.error("Graceful shutdown timed out");
      process.exit(1);
    }, 1e4);
    forceExit.unref();
    try {
      realtime.dispose();
      await new Promise((resolve) => httpServer.close(() => resolve()));
      await disconnectDatabase();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection");
  });
}
main().catch((error) => {
  logger.fatal({ err: error }, "Failed to start Cosmic Spider");
  process.exit(1);
});
