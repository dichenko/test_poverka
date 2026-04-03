import fs from "fs/promises";
import path from "path";
import { CronJob } from "cron";
import { logger } from "./common/logger";
import { prisma } from "./common/prisma";
import { env } from "./config/env";

const PHOTO_MIME_PREFIX = "image/";
const DAY_MS = 24 * 60 * 60 * 1000;

interface CleanupStats {
  scanned: number;
  deleted: number;
  failed: number;
}

function ensurePathInside(baseDir: string, targetPath: string) {
  const absoluteBase = path.resolve(baseDir);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteBase, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside base dir: ${absoluteTarget}`);
  }
  return absoluteTarget;
}

function resolveCutoffDate(now = new Date()) {
  return new Date(now.getTime() - env.FILE_RETENTION_DAYS * DAY_MS);
}

async function removePhotoFile(storageKey: string) {
  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const absolutePath = ensurePathInside(storageRoot, path.resolve(storageRoot, storageKey));
  await fs.rm(absolutePath, { force: true });
}

async function removeReportFile(absoluteFilePath: string) {
  const reportsRoot = path.resolve(env.REPORTS_BASE_DIR);
  const safePath = ensurePathInside(reportsRoot, path.resolve(absoluteFilePath));
  await fs.rm(safePath, { force: true });
}

async function cleanupPhotos(cutoffDate: Date, isShuttingDownRef: { value: boolean }) {
  const stats: CleanupStats = { scanned: 0, deleted: 0, failed: 0 };

  while (!isShuttingDownRef.value) {
    const rows = await prisma.fileEntity.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        mimeType: {
          startsWith: PHOTO_MIME_PREFIX
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: env.FILE_CLEANUP_BATCH_SIZE,
      select: {
        id: true,
        storageKey: true,
        compressedPath: true
      }
    });

    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      if (isShuttingDownRef.value) {
        break;
      }

      stats.scanned += 1;

      try {
        const filePaths = Array.from(
          new Set([row.storageKey, row.compressedPath].filter((item): item is string => Boolean(item)))
        );
        for (const storagePath of filePaths) {
          await removePhotoFile(storagePath);
        }

        const deleted = await prisma.fileEntity.deleteMany({
          where: {
            id: row.id
          }
        });
        if (deleted.count > 0) {
          stats.deleted += 1;
        }
      } catch (error) {
        stats.failed += 1;
        logger.error({ err: error, fileId: row.id }, "Failed to cleanup expired photo");
      }
    }
  }

  return stats;
}

async function cleanupReports(cutoffDate: Date, isShuttingDownRef: { value: boolean }) {
  const stats: CleanupStats = { scanned: 0, deleted: 0, failed: 0 };

  while (!isShuttingDownRef.value) {
    const rows = await prisma.generatedReport.findMany({
      where: {
        createdAt: { lt: cutoffDate }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: env.FILE_CLEANUP_BATCH_SIZE,
      select: {
        id: true,
        filePath: true
      }
    });

    if (!rows.length) {
      break;
    }

    for (const row of rows) {
      if (isShuttingDownRef.value) {
        break;
      }

      stats.scanned += 1;

      try {
        await removeReportFile(row.filePath);

        const deleted = await prisma.generatedReport.deleteMany({
          where: {
            id: row.id
          }
        });
        if (deleted.count > 0) {
          stats.deleted += 1;
        }
      } catch (error) {
        stats.failed += 1;
        logger.error(
          { err: error, generatedReportId: row.id.toString(), filePath: row.filePath },
          "Failed to cleanup expired report"
        );
      }
    }
  }

  return stats;
}

async function runCleanup(trigger: "cron" | "manual", isShuttingDownRef: { value: boolean }) {
  const cutoffDate = resolveCutoffDate();
  logger.info(
    {
      trigger,
      retentionDays: env.FILE_RETENTION_DAYS,
      cutoffDate: cutoffDate.toISOString(),
      batchSize: env.FILE_CLEANUP_BATCH_SIZE
    },
    "Cleanup worker cycle started"
  );

  const photos = await cleanupPhotos(cutoffDate, isShuttingDownRef);
  const reports = await cleanupReports(cutoffDate, isShuttingDownRef);

  logger.info(
    {
      trigger,
      photos,
      reports
    },
    "Cleanup worker cycle finished"
  );
}

async function start() {
  await prisma.$connect();

  const isShuttingDownRef = { value: false };
  let isCleanupRunning = false;

  const runScheduledCleanup = async () => {
    if (isCleanupRunning) {
      logger.warn("Cleanup cycle skipped because previous cycle is still running");
      return;
    }

    isCleanupRunning = true;
    try {
      await runCleanup("cron", isShuttingDownRef);
    } catch (error) {
      logger.error({ err: error }, "Cleanup worker cycle failed");
    } finally {
      isCleanupRunning = false;
    }
  };

  const cronJob = CronJob.from({
    cronTime: env.FILE_CLEANUP_CRON,
    start: true,
    timeZone: env.FILE_CLEANUP_TZ,
    onTick: () => {
      void runScheduledCleanup();
    }
  });

  logger.info(
    {
      cleanupCron: env.FILE_CLEANUP_CRON,
      cleanupTimeZone: env.FILE_CLEANUP_TZ,
      retentionDays: env.FILE_RETENTION_DAYS,
      batchSize: env.FILE_CLEANUP_BATCH_SIZE
    },
    "Cleanup worker started"
  );

  const shutdown = async (signal: string) => {
    if (isShuttingDownRef.value) {
      return;
    }
    isShuttingDownRef.value = true;
    logger.info({ signal }, "Cleanup worker shutting down");
    cronJob.stop();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

start().catch(async (error) => {
  logger.error({ err: error }, "Cleanup worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
