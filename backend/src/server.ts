import { createApp } from "./app";
import { logger } from "./common/logger";
import { prisma } from "./common/prisma";
import { env } from "./config/env";
import { syncMaxBotCommandsOnStartup } from "./modules/bot/bot-commands.service";

async function start() {
  await prisma.$connect();
  await syncMaxBotCommandsOnStartup();
  const app = createApp();
  app.listen(env.PORT, () => {
    logger.info({ port: env.PORT }, "Backend started");
  });
}

start().catch(async (error) => {
  logger.error({ err: error }, "Failed to start backend");
  await prisma.$disconnect();
  process.exit(1);
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down");
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
