import fs from "fs/promises";
import path from "path";
import { OcrRecognitionStatus } from "@prisma/client";
import { prisma } from "./common/prisma";
import { logger } from "./common/logger";
import { env } from "./config/env";

const ERROR_MAX_LENGTH = 2000;

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
  return `${env.PUBLIC_FILES_BASE_URL.replace(/\/$/, "")}/${normalizeStoragePath(storageRelativePath).replace(/^\/+/, "")}`;
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, ERROR_MAX_LENGTH);
}

function retryDelay(attemptsCount: number, retryAfterSeconds?: number) {
  if (retryAfterSeconds && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return retryAfterSeconds * 1000;
  }
  return env.OCR_RETRY_DELAY_MS * 2 ** Math.max(0, attemptsCount - 1);
}

function isTransientStatus(httpStatus: number) {
  return httpStatus === 429 || httpStatus === 503;
}

async function getAndLockNextRecognition() {
  const now = new Date();
  const recognition = await prisma.ocrRecognition.findFirst({
    where: {
      status: OcrRecognitionStatus.PENDING,
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }]
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  if (!recognition) {
    return null;
  }

  const locked = await prisma.ocrRecognition.updateMany({
    where: { id: recognition.id, status: OcrRecognitionStatus.PENDING },
    data: { status: OcrRecognitionStatus.PROCESSING, startedAt: recognition.startedAt ?? now, nextAttemptAt: null }
  });
  return locked.count ? recognition : null;
}

async function removeOriginal(originalPath: string) {
  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const absolutePath = ensureInsideBase(storageRoot, path.resolve(storageRoot, originalPath));
  await fs.rm(absolutePath, { force: true });
}

async function recognize(originalPath: string, originalMimeType: string) {
  if (!env.OCR_API_KEY) {
    throw new Error("OCR_API_KEY is not configured.");
  }

  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const absolutePath = ensureInsideBase(storageRoot, path.resolve(storageRoot, originalPath));
  const bytes = await fs.readFile(absolutePath);
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: originalMimeType }), path.basename(absolutePath));
  const response = await fetch(`${env.OCR_API_URL.replace(/\/$/, "")}/ocr`, {
    method: "POST",
    headers: { "X-API-Key": env.OCR_API_KEY },
    body: form,
    signal: AbortSignal.timeout(env.OCR_HTTP_TIMEOUT_MS)
  });
  const payload: unknown = await response.json().catch(() => null);
  const retryAfterSeconds = Number(response.headers.get("retry-after"));
  if (!response.ok) {
    const failure = new Error(`OCR request failed: HTTP ${response.status}; ${JSON.stringify(payload)}`);
    return { ok: false as const, transient: isTransientStatus(response.status), retryAfterSeconds, error: failure };
  }
  return { ok: true as const, payload };
}

async function saveResultFile(compressedPhotoUrl: string, payload: unknown) {
  const storageRoot = path.resolve(env.STORAGE_LOCAL_PATH);
  const compressedDir = ensureInsideBase(storageRoot, path.resolve(env.PHOTO_COMPRESSED_DIR));
  const filename = path.basename(new URL(compressedPhotoUrl).pathname, path.extname(new URL(compressedPhotoUrl).pathname));
  const resultPath = ensureInsideBase(compressedDir, path.join(compressedDir, `${filename}.json`));
  await fs.mkdir(compressedDir, { recursive: true });
  await fs.writeFile(resultPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return makePublicUrl(normalizeStoragePath(path.relative(storageRoot, resultPath)));
}

function getOcrStatus(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>).status;
  return typeof value === "string" ? value : null;
}

async function finishFailure(id: string, originalPath: string, attemptsCount: number, failure: unknown, transient: boolean, retryAfterSeconds?: number) {
  const canRetry = transient && attemptsCount <= env.OCR_MAX_RETRIES;
  if (canRetry) {
    await prisma.ocrRecognition.update({
      where: { id },
      data: {
        status: OcrRecognitionStatus.PENDING,
        attemptsCount,
        errorMessage: errorMessage(failure),
        nextAttemptAt: new Date(Date.now() + retryDelay(attemptsCount, retryAfterSeconds))
      }
    });
    return;
  }

  await prisma.ocrRecognition.update({
    where: { id },
    data: { status: OcrRecognitionStatus.FAILED, attemptsCount, errorMessage: errorMessage(failure), finishedAt: new Date() }
  });
  await removeOriginal(originalPath).catch((error) => logger.error({ err: error, id }, "Failed to delete OCR source photo"));
}

async function processOneRecognition() {
  const recognition = await getAndLockNextRecognition();
  if (!recognition) {
    return false;
  }

  const attemptsCount = recognition.attemptsCount + 1;
  try {
    const result = await recognize(recognition.originalPath, recognition.originalMimeType);
    if (!result.ok) {
      await finishFailure(recognition.id, recognition.originalPath, attemptsCount, result.error, result.transient, result.retryAfterSeconds);
      return true;
    }

    const resultJsonUrl = await saveResultFile(recognition.compressedPhotoUrl, result.payload);
    await prisma.ocrRecognition.update({
      where: { id: recognition.id },
      data: {
        status: OcrRecognitionStatus.COMPLETED,
        ocrStatus: getOcrStatus(result.payload),
        responsePayload: result.payload as object,
        resultJsonUrl,
        attemptsCount,
        errorMessage: null,
        finishedAt: new Date()
      }
    });
    await removeOriginal(recognition.originalPath).catch((error) =>
      logger.error({ err: error, recognitionId: recognition.id }, "Failed to delete OCR source photo")
    );
    logger.info({ recognitionId: recognition.id, resultJsonUrl }, "OCR recognition completed");
  } catch (error) {
    // Network, file-system and JSON write failures are isolated to this optional worker.
    await finishFailure(recognition.id, recognition.originalPath, attemptsCount, error, true);
    logger.error({ err: error, recognitionId: recognition.id }, "OCR recognition failed");
  }
  return true;
}

let isShuttingDown = false;

async function loop() {
  while (!isShuttingDown) {
    try {
      if (!await processOneRecognition()) {
        await sleep(env.OCR_WORKER_POLL_INTERVAL_MS);
      }
    } catch (error) {
      logger.error({ err: error }, "OCR worker loop error");
      await sleep(env.OCR_WORKER_POLL_INTERVAL_MS);
    }
  }
}

async function start() {
  await prisma.$connect();
  logger.info({ pollIntervalMs: env.OCR_WORKER_POLL_INTERVAL_MS }, "OCR worker started");
  await loop();
  await prisma.$disconnect();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    isShuttingDown = true;
    logger.info({ signal }, "OCR worker shutting down");
  });
}

start().catch((error) => {
  logger.error({ err: error }, "OCR worker failed to start");
  process.exit(1);
});
