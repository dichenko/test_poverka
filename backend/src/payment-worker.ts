import { logger } from "./common/logger";
import { prisma } from "./common/prisma";
import { env } from "./config/env";
import { listTopupsForPolling, reconcileTopupWithProvider } from "./modules/payments/topups.service";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let isShuttingDown = false;

async function processBatch() {
  const batch = await listTopupsForPolling(env.PAYMENT_POLL_BATCH_SIZE);
  if (!batch.length) {
    return 0;
  }

  for (const topup of batch) {
    if (isShuttingDown) {
      break;
    }

    try {
      await reconcileTopupWithProvider(topup.id);
    } catch (error) {
      logger.error({ err: error, topupId: topup.id }, "Payment worker failed to reconcile topup");
    }
  }

  return batch.length;
}

async function loop() {
  const waitMs = env.PAYMENT_POLL_INTERVAL_SECONDS * 1000;

  while (!isShuttingDown) {
    try {
      const processed = await processBatch();
      logger.debug({ processed }, "Payment worker cycle finished");
    } catch (error) {
      logger.error({ err: error }, "Payment worker cycle failed");
    }

    await sleep(waitMs);
  }
}

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;

  logger.info({ signal }, "Payment worker shutting down");
  await prisma.$disconnect();
  process.exit(0);
}

async function start() {
  await prisma.$connect();

  logger.info(
    {
      pollIntervalSeconds: env.PAYMENT_POLL_INTERVAL_SECONDS,
      batchSize: env.PAYMENT_POLL_BATCH_SIZE
    },
    "Payment worker started"
  );

  await loop();
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

start().catch(async (error) => {
  logger.error({ err: error }, "Payment worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
