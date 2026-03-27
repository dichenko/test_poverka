import fs from "fs/promises";
import crypto from "crypto";
import path from "path";
import sharp from "sharp";
import { prisma } from "./common/prisma";
import { logger } from "./common/logger";
import { env } from "./config/env";

const IMAGE_MIME_PREFIX = "image/";
const PROCESSING_ERROR_MAX_LENGTH = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeStoragePath(value: string) {
  return value.split(path.sep).join("/");
}

function ensureInsideBase(baseDir: string, targetPath: string) {
  const absoluteBase = path.resolve(baseDir);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteBase, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside storage: ${absoluteTarget}`);
  }
  return absoluteTarget;
}

function makePublicUrl(storageRelativePath: string) {
  const normalized = normalizeStoragePath(storageRelativePath).replace(/^\/+/, "");
  return `${env.PUBLIC_FILES_BASE_URL.replace(/\/$/, "")}/${normalized}`;
}

function toErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, PROCESSING_ERROR_MAX_LENGTH);
}

async function getNextUnprocessedImage() {
  return prisma.fileEntity.findFirst({
    where: {
      processedAt: null,
      processingError: null,
      mimeType: {
        startsWith: IMAGE_MIME_PREFIX
      }
    },
    orderBy: {
      createdAt: "asc"
    }
  });
}

async function processOneFile() {
  const file = await getNextUnprocessedImage();
  if (!file) {
    return false;
  }

  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const compressedDir = ensureInsideBase(storageRoot, path.resolve(env.PHOTO_COMPRESSED_DIR));
  await fs.mkdir(compressedDir, { recursive: true });

  const originalPath = ensureInsideBase(storageRoot, path.resolve(storageRoot, file.storageKey));
  const outputFileName = `${crypto.randomUUID()}.jpg`;
  const compressedPath = ensureInsideBase(compressedDir, path.join(compressedDir, outputFileName));
  const compressedStoragePath = normalizeStoragePath(path.relative(storageRoot, compressedPath));

  try {
    await fs.access(originalPath);

    const info = await sharp(originalPath)
      .rotate()
      .resize({
        width: 1800,
        height: 1800,
        fit: "inside",
        withoutEnlargement: true
      })
      .jpeg({
        quality: 50,
        mozjpeg: true
      })
      .toFile(compressedPath);

    const publicUrl = makePublicUrl(compressedStoragePath);

    await prisma.fileEntity.update({
      where: {
        id: file.id
      },
      data: {
        storageKey: compressedStoragePath,
        compressedPath: compressedStoragePath,
        publicUrl,
        mimeType: "image/jpeg",
        sizeBytes: info.size,
        processedAt: new Date(),
        processingError: null
      }
    });

    await fs.rm(originalPath, { force: true });
    logger.info(
      {
        fileId: file.id,
        originalPath,
        compressedPath,
        publicUrl
      },
      "Photo processed successfully"
    );
  } catch (error) {
    const errorMessage = toErrorMessage(error);
    logger.error(
      {
        err: error,
        fileId: file.id,
        originalPath
      },
      "Photo processing failed"
    );

    await prisma.fileEntity
      .update({
        where: {
          id: file.id
        },
        data: {
          processingError: errorMessage,
          processedAt: null
        }
      })
      .catch((updateError) => {
        logger.error(
          {
            err: updateError,
            fileId: file.id
          },
          "Failed to save processing error for file"
        );
      });
  }

  return true;
}

let isShuttingDown = false;

async function loop() {
  while (!isShuttingDown) {
    try {
      const processed = await processOneFile();
      if (!processed) {
        await sleep(env.PHOTO_WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      logger.error({ err: error }, "Photo worker loop error");
      await sleep(env.PHOTO_WORKER_POLL_INTERVAL_MS);
    }
  }
}

async function shutdown(signal: string) {
  if (isShuttingDown) {
    return;
  }
  isShuttingDown = true;
  logger.info({ signal }, "Photo worker shutting down");
  await prisma.$disconnect();
  process.exit(0);
}

async function start() {
  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const originalDir = ensureInsideBase(storageRoot, path.resolve(env.PHOTO_ORIGINAL_DIR));
  const compressedDir = ensureInsideBase(storageRoot, path.resolve(env.PHOTO_COMPRESSED_DIR));

  await fs.mkdir(originalDir, { recursive: true });
  await fs.mkdir(compressedDir, { recursive: true });
  await prisma.$connect();

  logger.info(
    {
      pollIntervalMs: env.PHOTO_WORKER_POLL_INTERVAL_MS,
      originalDir,
      compressedDir
    },
    "Photo worker started"
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
  logger.error({ err: error }, "Photo worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
