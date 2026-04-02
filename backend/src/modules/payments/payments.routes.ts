import crypto from "crypto";
import { Router } from "express";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import {
  createWebhookLog,
  fetchPaymentForWebhookObject,
  markTopupWebhookProcessing,
  processPaymentCanceled,
  processPaymentSucceeded
} from "./topups.service";
import { YookassaHttpError, yookassaClient } from "./yookassa.client";

const router = Router();

function normalizeHeaders(headers: Record<string, unknown>) {
  const normalized: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      normalized[key] = value.map((item) => String(item));
    } else if (value != null) {
      normalized[key] = String(value);
    }
  }
  return normalized;
}

function shouldRetryWebhook(error: unknown) {
  if (error instanceof YookassaHttpError) {
    return error.retryable;
  }

  if (error instanceof AppError) {
    return error.statusCode >= 500;
  }

  return true;
}

router.post("/api/payments/yookassa/webhook", async (req, res, next) => {
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(JSON.stringify(req.body ?? {}));
  const payloadSha256 = crypto.createHash("sha256").update(rawBody).digest("hex");

  const eventType = String(req.body?.event ?? req.body?.type ?? "unknown");
  const providerObjectId = String(req.body?.object?.id ?? "unknown");
  const remoteIp = req.ip ?? null;
  const isTrustedIp = yookassaClient.verifyWebhookIp(remoteIp);

  let webhookLogId: bigint | null = null;

  const webhookLog = await createWebhookLog({
    eventType,
    providerObjectId,
    remoteIp,
    isTrustedIp,
    headers: normalizeHeaders(req.headers as Record<string, unknown>),
    payload: req.body ?? {},
    payloadSha256
  });

  webhookLogId = webhookLog.id;

  if (!isTrustedIp) {
    logger.warn(
      {
        webhookLogId: webhookLogId?.toString(),
        remoteIp: remoteIp ?? "unknown"
      },
      "YooKassa webhook IP is not in allowlist, processing anyway"
    );
  }

  if (eventType !== "payment.succeeded" && eventType !== "payment.canceled") {
    await markTopupWebhookProcessing({
      webhookLogId: webhookLogId!,
      processingStatus: "ignored_unsupported_event"
    });

    return res.status(200).json({ ok: true, ignored: "EVENT_NOT_SUPPORTED" });
  }

  try {
    const payment = await fetchPaymentForWebhookObject({
      eventType,
      providerObjectId,
      payloadObject: (req.body?.object as Record<string, unknown> | undefined) ?? null
    });

    const processed =
      eventType === "payment.succeeded"
        ? await processPaymentSucceeded({
            payment,
            source: "webhook",
            rawPayload: req.body ?? {}
          })
        : await processPaymentCanceled({
            payment,
            source: "webhook",
            rawPayload: req.body ?? {}
          });

    await markTopupWebhookProcessing({
      webhookLogId: webhookLogId!,
      processingStatus: "processed",
      topupId: processed.topup?.id ?? null
    });

    return res.status(200).json({ ok: true });
  } catch (error) {
    await markTopupWebhookProcessing({
      webhookLogId: webhookLogId!,
      processingStatus: "failed",
      processingError: error instanceof Error ? error.message : String(error)
    }).catch((updateError) => {
      logger.error({ err: updateError, webhookLogId: webhookLogId?.toString() }, "Failed to update webhook log status");
    });

    if (shouldRetryWebhook(error)) {
      return next(error);
    }

    logger.warn({ err: error, webhookLogId: webhookLogId?.toString() }, "Webhook failed with non-retryable error");
    return res.status(200).json({ ok: true, ignored: true });
  }
});

export { router as paymentsRoutes };
