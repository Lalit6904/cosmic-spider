import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDatabase, disconnectDatabase } from './db/connect';
import { GameHub } from './game/GameHub';
import { logger } from './lib/logger';
import { RealtimeService } from './socket/RealtimeService';

async function main(): Promise<void> {
  await connectDatabase();
  const hub = new GameHub();
  const app = createApp({ hub });
  const httpServer = createServer(app);
  httpServer.requestTimeout = 30_000;
  httpServer.headersTimeout = 35_000;
  httpServer.keepAliveTimeout = 5_000;
  httpServer.maxRequestsPerSocket = 1_000;
  const realtime = new RealtimeService(httpServer, hub);

  httpServer.listen(env.PORT, env.HOST, () => {
    logger.info(
      { host: env.HOST, port: env.PORT, origins: env.allowedOrigins },
      'Cosmic Spider listening',
    );
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');
    const forceExit = setTimeout(() => {
      logger.error('Graceful shutdown timed out');
      process.exit(1);
    }, 10_000);
    forceExit.unref();
    try {
      realtime.dispose();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
      await disconnectDatabase();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'Shutdown failed');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
  });
}

main().catch((error) => {
  logger.fatal({ err: error }, 'Failed to start Cosmic Spider');
  process.exit(1);
});
