import { SubmissionStatus } from "@prisma/client";
import path from "path";
import { Router } from "express";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { authRateLimit } from "../../middlewares/rate-limit";
import { logAuditEvent } from "../../services/audit.service";
import { getStorageProvider } from "../storage/storage.service";
import {
  cancelAllUnfinishedSubmissions,
  cancelPendingSubmission,
  getLatestPendingSubmission,
  getAwaitingPhotoSubmission,
  markSubmissionAwaitingPhoto
} from "../submissions/submissions.service";
import { maxBotClient } from "./max-bot.client";
import {
  knownUserUnexpectedMessage,
  noPendingSubmissionMessage,
  photoRequiredMessage,
  photoSavedAndConfirmedMessage,
  profileMessage,
  submissionCancelledMessage,
  unknownUserMessage
} from "./bot.templates";

const router = Router();
const MAX_LOG_TEXT_LIMIT = 500;

function pickFirstNonEmpty(...candidates: unknown[]): string {
  for (const value of candidates) {
    const normalized = String(value ?? "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function extractEvent(body: any) {
  const type = pickFirstNonEmpty(body?.update_type, body?.type, body?.event_type, "message_created");
  const userId = pickFirstNonEmpty(
    body?.user_id,
    body?.user?.id,
    body?.from?.id,
    body?.sender?.id,
    body?.sender?.user_id,
    body?.message?.from?.id,
    body?.message?.from?.user_id,
    body?.message?.sender?.id,
    body?.message?.sender?.user_id,
    body?.message?.user_id,
    body?.payload?.user_id,
    body?.payload?.sender?.id,
    body?.payload?.sender?.user_id,
    body?.callback?.user_id,
    body?.callback?.sender?.user_id
  );
  const text = pickFirstNonEmpty(
    body?.text,
    body?.message?.text,
    body?.message?.body?.text,
    body?.message?.body,
    body?.payload?.text,
    body?.payload?.message?.text
  );
  const callbackPayload = pickFirstNonEmpty(
    body?.callback?.payload,
    body?.payload?.callback?.payload,
    body?.message?.callback?.payload,
    body?.payload
  );
  const callbackId = pickFirstNonEmpty(
    body?.callback?.callback_id,
    body?.payload?.callback?.callback_id,
    body?.message?.callback?.callback_id,
    body?.callback_id
  );
  const messageId = pickFirstNonEmpty(
    body?.message?.body?.mid,
    body?.message?.mid,
    body?.payload?.message?.body?.mid,
    body?.payload?.message?.mid,
    body?.mid
  );

  return {
    type,
    userId,
    text,
    callbackPayload,
    callbackId,
    messageId
  };
}

function formatIncomingLog(userId: string, text: string) {
  const now = new Date().toISOString();
  const safeText = text.replace(/\s+/g, " ").trim().slice(0, MAX_LOG_TEXT_LIMIT);
  return `${now} - ${userId || "-"} - ${safeText || "-"}`;
}

function formatRemainingPackages(balance: number | null | undefined, userTarif: number | null | undefined) {
  if (balance == null || userTarif == null || userTarif <= 0) {
    return "0";
  }
  const value = balance / userTarif;
  if (!Number.isFinite(value) || value < 0) {
    return "0";
  }
  return value.toFixed(1).replace(/\.0$/, "");
}

function cancelKeyboard(submissionId: string) {
  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "message",
              text: "Отменить",
              payload: `cancel_submission:${submissionId}`
            }
          ]
        ]
      }
    }
  ];
}

function collectAttachments(body: any): any[] {
  const candidates = [
    body?.attachments,
    body?.message?.attachments,
    body?.message?.body?.attachments,
    body?.payload?.attachments,
    body?.payload?.message?.attachments,
    body?.payload?.message?.body?.attachments
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }
  return [];
}

function extractUrlsDeep(node: any, out: string[] = []): string[] {
  if (!node) {
    return out;
  }
  if (typeof node === "string") {
    if (/^https?:\/\//i.test(node)) {
      out.push(node);
    }
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      extractUrlsDeep(item, out);
    }
    return out;
  }
  if (typeof node === "object") {
    for (const value of Object.values(node)) {
      extractUrlsDeep(value, out);
    }
  }
  return out;
}

function pickImageUrl(attachments: any[]): string {
  const urls = extractUrlsDeep(attachments, []);
  const preferred = urls.find((item) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item));
  if (preferred) {
    return preferred;
  }
  return urls[0] || "";
}

async function downloadPhoto(url: string) {
  const tryFetch = async (withAuth: boolean) =>
    fetch(url, {
      headers: withAuth ? { Authorization: env.MAX_BOT_TOKEN } : undefined
    });

  let response = await tryFetch(true);
  if (!response.ok) {
    response = await tryFetch(false);
  }
  if (!response.ok) {
    throw new AppError("Failed to download photo.", 502, "PHOTO_DOWNLOAD_FAILED");
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new AppError("Attachment is not an image.", 400, "PHOTO_INVALID_MIME");
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const pathname = new URL(url).pathname;
  const fromUrl = path.basename(pathname);
  const extension = path.extname(fromUrl) || ".jpg";
  const originalName = fromUrl && fromUrl.includes(".") ? fromUrl : `photo_${Date.now()}${extension}`;

  return {
    buffer,
    mimeType: contentType,
    originalName
  };
}

async function getUserProfilePayload(userId: bigint) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true }
  });
  if (!user) {
    return null;
  }

  const tarif = user.userTarif ?? user.organization?.userTarif;
  const remainingPackages = formatRemainingPackages(user.organization?.balance, tarif);

  return {
    user,
    remainingPackages,
    text: profileMessage({
      maxUserId: user.id.toString(),
      fullName: user.fullName,
      organizationName: user.organization?.name ?? null,
      remainingPackages
    })
  };
}

function parseActionToken(value: string) {
  if (!value) {
    return { kind: "none", submissionId: "" } as const;
  }
  const normalized = value.trim();
  const lowered = normalized.toLowerCase();
  if (lowered === "подтвердить" || lowered === "confirm") {
    return { kind: "confirm", submissionId: "" } as const;
  }
  if (lowered === "отменить" || lowered === "cancel") {
    return { kind: "cancel", submissionId: "" } as const;
  }
  if (normalized.startsWith("confirm_submission:")) {
    return { kind: "confirm", submissionId: normalized.slice("confirm_submission:".length).trim() } as const;
  }
  if (normalized.startsWith("cancel_submission:")) {
    return { kind: "cancel", submissionId: normalized.slice("cancel_submission:".length).trim() } as const;
  }
  return { kind: "none", submissionId: "" } as const;
}

function parseActionTokenFromUnknown(value: unknown, depth = 0): { kind: "confirm" | "cancel" | "none"; submissionId: string } {
  if (depth > 8 || value == null) {
    return { kind: "none", submissionId: "" };
  }

  if (typeof value === "string") {
    const fromText = parseActionToken(value);
    if (fromText.kind !== "none") {
      return fromText;
    }

    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return parseActionTokenFromUnknown(parsed, depth + 1);
      } catch {
        return { kind: "none", submissionId: "" };
      }
    }

    return { kind: "none", submissionId: "" };
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseActionTokenFromUnknown(item, depth + 1);
      if (parsed.kind !== "none") {
        return parsed;
      }
    }
    return { kind: "none", submissionId: "" };
  }

  if (typeof value === "object") {
    const candidateKeys = [
      "payload",
      "text",
      "data",
      "command",
      "action",
      "value",
      "callback",
      "callback_data",
      "message"
    ];
    for (const key of candidateKeys) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested == null) {
        continue;
      }
      const parsed = parseActionTokenFromUnknown(nested, depth + 1);
      if (parsed.kind !== "none") {
        return parsed;
      }
    }
  }

  return { kind: "none", submissionId: "" };
}

function resolveActionFromEvent(event: { callbackPayload: string; text: string }, body: any) {
  const candidates: unknown[] = [
    body?.callback?.payload,
    body?.payload?.callback?.payload,
    body?.message?.callback?.payload,
    body?.message?.body?.payload,
    body?.message?.payload,
    body?.payload?.message?.payload,
    body?.payload?.message?.body?.payload,
    body?.payload,
    event.callbackPayload,
    event.text
  ];

  for (const candidate of candidates) {
    const parsed = parseActionTokenFromUnknown(candidate);
    if (parsed.kind !== "none") {
      return parsed;
    }
  }

  return { kind: "none", submissionId: "" } as const;
}

async function resolveActionSubmissionId(userId: string, explicitSubmissionId: string) {
  if (explicitSubmissionId) {
    return explicitSubmissionId;
  }
  const pending = await getLatestPendingSubmission(userId);
  return pending?.id ?? "";
}

function isStartCommand(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^\/start(?:@\w+)?(?:\s|$)/i.test(normalized);
}

async function handleConfirmAction(input: {
  submissionId: string;
  userId: string;
  callbackId?: string;
  req: any;
}) {
  const submission = await markSubmissionAwaitingPhoto({
    submissionId: input.submissionId,
    userId: input.userId
  });

  await maxBotClient.sendMessage({
    userId: input.userId,
    text: photoRequiredMessage(),
    attachments: cancelKeyboard(submission.id)
  });

  await logAuditEvent({
    actorUserId: input.userId,
    action: "bot.submission.awaiting_photo",
    entityType: "SUBMISSION",
    entityId: submission.id,
    req: input.req
  });

  if (input.callbackId) {
    await maxBotClient.answerCallback({
      callbackId: input.callbackId,
      notification: "Прикрепите фотографию счетчика"
    });
  }
}

async function handleCancelAction(input: {
  submissionId: string;
  userId: string;
  callbackId?: string;
  req: any;
  profileText: string;
}) {
  const cancelled = await cancelPendingSubmission({
    submissionId: input.submissionId,
    userId: input.userId
  });

  const storageProvider = getStorageProvider();
  for (const storageKey of cancelled.storageKeys) {
    try {
      await storageProvider.deleteFile(storageKey);
    } catch (error) {
      logger.warn({ err: error, storageKey }, "Failed to delete file for canceled submission");
    }
  }

  await logAuditEvent({
    actorUserId: input.userId,
    action: "bot.submission.cancelled",
    entityType: "SUBMISSION",
    entityId: input.submissionId,
    req: input.req
  });

  await maxBotClient.sendMessage({
    userId: input.userId,
    text: `${submissionCancelledMessage()}\n\n${input.profileText}`
  });

  if (input.callbackId) {
    await maxBotClient.answerCallback({
      callbackId: input.callbackId,
      notification: "Заявка отменена"
    });
  }
}

async function handleStartCommand(input: { userId: string; req: any; profileText: string }) {
  const cancelled = await cancelAllUnfinishedSubmissions({
    userId: input.userId
  });

  const storageProvider = getStorageProvider();
  for (const storageKey of cancelled.storageKeys) {
    try {
      await storageProvider.deleteFile(storageKey);
    } catch (error) {
      logger.warn({ err: error, storageKey }, "Failed to delete file while processing /start");
    }
  }

  await logAuditEvent({
    actorUserId: input.userId,
    action: "bot.start.reset.submissions",
    entityType: "SYSTEM",
    meta: {
      cancelledCount: cancelled.cancelledCount
    },
    req: input.req
  });

  const prefix =
    cancelled.cancelledCount > 0
      ? `Команда /start выполнена. Отменено незавершенных заявок: ${cancelled.cancelledCount}.`
      : "Команда /start выполнена. Незавершенных заявок не найдено.";

  await maxBotClient.sendMessage({
    userId: input.userId,
    text: `${prefix}\n\n${input.profileText}`
  });
}

router.post("/webhook/max", authRateLimit, async (req, res, next) => {
  try {
    const secret = req.header("X-Max-Bot-Api-Secret");
    if (!secret || secret !== env.MAX_WEBHOOK_SECRET) {
      throw new AppError("Invalid X-Max-Bot-Api-Secret header.", 401, "WEBHOOK_SECRET_INVALID");
    }

    const event = extractEvent(req.body);
    logger.info({ eventType: event.type }, formatIncomingLog(event.userId, event.text || event.callbackPayload));

    if (!event.userId) {
      logger.warn(
        { eventType: event.type, topLevelKeys: Object.keys(req.body ?? {}) },
        "MAX webhook event skipped: missing user id"
      );
      return res.json({ ok: true, skipped: "WEBHOOK_USER_MISSING" });
    }

    let numericUserId: bigint;
    try {
      numericUserId = BigInt(event.userId);
    } catch {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: unknownUserMessage(event.userId)
      });
      return res.json({ ok: true });
    }

    const profile = await getUserProfilePayload(numericUserId);
    if (!profile) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: unknownUserMessage(event.userId)
      });
      return res.json({ ok: true });
    }

    const isCallbackEvent = event.type === "message_callback" || Boolean(event.callbackId);

    if (isCallbackEvent) {
      const action = resolveActionFromEvent(event, req.body);
      const actionSubmissionId = await resolveActionSubmissionId(event.userId, action.submissionId);

      if (action.kind === "confirm" && actionSubmissionId) {
        await handleConfirmAction({
          submissionId: actionSubmissionId,
          userId: event.userId,
          callbackId: event.callbackId || undefined,
          req
        });
        return res.json({ ok: true, handled: "SUBMISSION_AWAITING_PHOTO" });
      }

      if (action.kind === "cancel" && actionSubmissionId) {
        await handleCancelAction({
          submissionId: actionSubmissionId,
          userId: event.userId,
          callbackId: event.callbackId || undefined,
          req,
          profileText: profile.text
        });
        return res.json({ ok: true, handled: "SUBMISSION_CANCELLED" });
      }

      if (action.kind !== "none" && !actionSubmissionId) {
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: `${noPendingSubmissionMessage()}\n\n${profile.text}`
        });

        if (event.callbackId) {
          await maxBotClient.answerCallback({
            callbackId: event.callbackId,
            notification: "Нет заявок для действия"
          });
        }

        return res.json({ ok: true, handled: "NO_PENDING_SUBMISSION" });
      }

      if (event.callbackId) {
        await maxBotClient.answerCallback({
          callbackId: event.callbackId,
          notification: "Неизвестное действие"
        });
      }
      return res.json({ ok: true, skipped: "CALLBACK_NOT_HANDLED" });
    }

    if (event.type !== "message_created") {
      return res.json({ ok: true, skipped: "EVENT_TYPE_NOT_SUPPORTED" });
    }

    if (isStartCommand(event.text)) {
      await handleStartCommand({
        userId: event.userId,
        req,
        profileText: profile.text
      });
      return res.json({ ok: true, handled: "START_RESET" });
    }

    const messageAction = resolveActionFromEvent(event, req.body);
    const messageActionSubmissionId = await resolveActionSubmissionId(event.userId, messageAction.submissionId);
    if (messageAction.kind === "confirm" && messageActionSubmissionId) {
      await handleConfirmAction({
        submissionId: messageActionSubmissionId,
        userId: event.userId,
        req
      });
      return res.json({ ok: true, handled: "SUBMISSION_AWAITING_PHOTO" });
    }

    if (messageAction.kind === "cancel" && messageActionSubmissionId) {
      await handleCancelAction({
        submissionId: messageActionSubmissionId,
        userId: event.userId,
        req,
        profileText: profile.text
      });
      return res.json({ ok: true, handled: "SUBMISSION_CANCELLED" });
    }

    if (messageAction.kind !== "none" && !messageActionSubmissionId) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: `${noPendingSubmissionMessage()}\n\n${profile.text}`
      });
      return res.json({ ok: true, handled: "NO_PENDING_SUBMISSION" });
    }

    const awaiting = await getAwaitingPhotoSubmission(event.userId);
    if (awaiting) {
      let attachments = collectAttachments(req.body);
      let photoUrl = pickImageUrl(attachments);

      if (!photoUrl && event.messageId) {
        const messageResult = await maxBotClient.getMessage(event.messageId);
        if (messageResult.ok) {
          attachments = collectAttachments(messageResult.message || {});
          photoUrl = pickImageUrl(attachments);
        }
      }

      if (!photoUrl) {
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: photoRequiredMessage(),
          attachments: cancelKeyboard(awaiting.id)
        });
        return res.json({ ok: true, handled: "AWAITING_PHOTO_REMINDER" });
      }

      const photo = await downloadPhoto(photoUrl);
      const storageProvider = getStorageProvider();
      const stored = await storageProvider.saveFile({
        buffer: photo.buffer,
        originalName: photo.originalName,
        mimeType: photo.mimeType
      });

      const file = await prisma.fileEntity.create({
        data: {
          ownerUserId: numericUserId,
          submissionId: awaiting.id,
          storageKey: stored.storageKey,
          originalName: stored.originalName,
          mimeType: stored.mimeType,
          sizeBytes: stored.sizeBytes,
          publicUrl: stored.publicUrl
        }
      });

      await prisma.meterSubmission.update({
        where: { id: awaiting.id },
        data: {
          status: SubmissionStatus.CONFIRMED,
          confirmedAt: new Date(),
          awaitingPhoto: false
        }
      });

      await prisma.submissionStatusHistory.create({
        data: {
          submissionId: awaiting.id,
          oldStatus: SubmissionStatus.PENDING_CONFIRMATION,
          newStatus: SubmissionStatus.CONFIRMED,
          changedByUserId: numericUserId,
          reason: "Confirmed with photo in bot."
        }
      });

      await logAuditEvent({
        actorUserId: event.userId,
        action: "bot.submission.photo.saved",
        entityType: "FILE",
        entityId: file.id,
        meta: { submissionId: awaiting.id },
        req
      });

      await maxBotClient.sendMessage({
        userId: event.userId,
        text: `${photoSavedAndConfirmedMessage()}\n\n${profile.text}`
      });

      return res.json({ ok: true, handled: "SUBMISSION_CONFIRMED_WITH_PHOTO" });
    }

    await maxBotClient.sendMessage({
      userId: event.userId,
      text: knownUserUnexpectedMessage(event.userId, profile.remainingPackages)
    });

    await logAuditEvent({
      actorUserId: profile.user.id,
      action: "bot.unexpected.message.reply.sent",
      entityType: "SYSTEM",
      meta: {
        eventType: event.type,
        remainingPackages: profile.remainingPackages
      },
      req
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export { router as botRoutes };
