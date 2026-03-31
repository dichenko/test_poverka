import { logger } from "./common/logger";
import { prisma } from "./common/prisma";
import { createReportMailService } from "./report-mail/create-report-mail-service";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isShuttingDown = false;

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, "Mail worker shutting down");
  await prisma.$disconnect();
  process.exit(0);
}

async function loop(pollIntervalMs: number, runOnce: () => Promise<boolean>) {
  while (!isShuttingDown) {
    try {
      const processed = await runOnce();
      if (!processed) {
        await sleep(pollIntervalMs);
      }
    } catch (error) {
      logger.error({ err: error }, "Mail worker cycle failed");
      await sleep(pollIntervalMs);
    }
  }
}

async function start() {
  await prisma.$connect();
  const { service, mailEnv } = createReportMailService({ prisma, logger });

  try {
    await service.ensureSmtpConnection();
    logger.info("SMTP connection verified");
  } catch (error) {
    logger.error({ err: error }, "SMTP verification failed on startup; worker will continue with retries");
  }

  logger.info(
    {
      pollIntervalMs: mailEnv.MAIL_WORKER_POLL_INTERVAL_MS,
      maxAttempts: mailEnv.MAIL_MAX_ATTEMPTS,
      retryDelayMs: mailEnv.MAIL_RETRY_DELAY_MS,
      reportsBaseDir: mailEnv.REPORTS_BASE_DIR
    },
    "Mail worker started"
  );

  await loop(mailEnv.MAIL_WORKER_POLL_INTERVAL_MS, async () => {
    const result = await service.processNextPendingRun();
    return Boolean(result);
  });
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch(async (error) => {
  logger.error({ err: error }, "Mail worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
