import path from "path";
import { UserRole } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { authRateLimit } from "../../middlewares/rate-limit";
import { logAuditEvent } from "../../services/audit.service";
import { isSubmissionWindowOpen } from "../../services/submission-window.service";
import {
  createOrReuseTopupForUser,
  getActiveTopupForUser,
  getActiveTopupUserMessage,
  getTopupPaymentLinkMessage,
  parsePackagesCountFromText
} from "../payments/topups.service";
import { getStorageProvider } from "../storage/storage.service";
import {
  cancelAllUnfinishedSubmissions,
  cancelPendingSubmission,
  confirmSubmission,
  getAwaitingPhotoSubmission,
  getLatestPendingSubmission,
  markSubmissionAwaitingPhoto,
  rejectSubmissionForInsufficientBalance
} from "../submissions/submissions.service";
import {
  BOT_STATE_ACTIVE_TOPUP_PENDING,
  BOT_STATE_AWAITING_TOPUP_PACKAGES,
  clearBotUserState,
  getBotUserState,
  setBotUserState
} from "./bot-state.service";
import { maxBotClient } from "./max-bot.client";
import { handleAdminCommand, isAdminCommandText, sendAdminAccessDenied } from "./admin-command-handler";
import { getUserProfilePayload } from "./profile.service";
import {
  insufficientBalanceMessage,
  noPendingSubmissionMessage,
  photoRequiredMessage,
  photoSavedAndConfirmedMessage,
  submissionCancelledMessage,
  unknownUserMessage
} from "./bot.templates";

const router = Router();
const MAX_LOG_TEXT_LIMIT = 500;
const TOPUP_CANCEL_CALLBACK_PAYLOAD = "cancel_topup_flow";
const RU_TOPUP_BALANCE = "\u043f\u043e\u043f\u043e\u043b\u043d\u0438\u0442\u044c \u0431\u0430\u043b\u0430\u043d\u0441";
const RU_CONFIRM = "\u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044c";
const RU_CANCEL = "\u043e\u0442\u043c\u0435\u043d\u0438\u0442\u044c";
const RU_CANCEL_SHORT = "\u043e\u0442\u043c\u0435\u043d\u0430";
const RU_NOTIFY_ATTACH_PHOTO =
  "\u041f\u0440\u0438\u043a\u0440\u0435\u043f\u0438\u0442\u0435 \u0444\u043e\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u044e \u0441\u0447\u0435\u0442\u0447\u0438\u043a\u0430";
const RU_NOTIFY_SUBMISSION_CANCELLED = "\u0417\u0430\u044f\u0432\u043a\u0430 \u043e\u0442\u043c\u0435\u043d\u0435\u043d\u0430";
const RU_NOTIFY_ACTIVE_TOPUP_EXISTS =
  "\u0415\u0441\u0442\u044c \u0430\u043a\u0442\u0438\u0432\u043d\u043e\u0435 \u043f\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435";
const RU_TEXT_HOW_MANY_PACKAGES =
  "\u0421\u043a\u043e\u043b\u044c\u043a\u043e \u043f\u0430\u043a\u0435\u0442\u043e\u0432 \u0445\u043e\u0442\u0438\u0442\u0435 \u043a\u0443\u043f\u0438\u0442\u044c?";
const RU_NOTIFY_ENTER_PACKAGES =
  "\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u043b\u0438\u0447\u0435\u0441\u0442\u0432\u043e \u043f\u0430\u043a\u0435\u0442\u043e\u0432";
const RU_TEXT_TOPUP_SCENARIO_CANCELLED =
  "\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439 \u043f\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u044f \u043e\u0442\u043c\u0435\u043d\u0435\u043d.";
const RU_NOTIFY_TOPUP_CANCELLED =
  "\u041f\u043e\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435 \u043e\u0442\u043c\u0435\u043d\u0435\u043d\u043e";
const RU_NOTIFY_SCENARIO_ALREADY_FINISHED =
  "\u0421\u0446\u0435\u043d\u0430\u0440\u0438\u0439 \u0443\u0436\u0435 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d";
const RU_NOTIFY_NO_PENDING_FOR_ACTION =
  "\u041d\u0435\u0442 \u0437\u0430\u044f\u0432\u043e\u043a \u0434\u043b\u044f \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f";
const RU_NOTIFY_UNKNOWN_ACTION =
  "\u041d\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043d\u043e\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435";
const ACT_TEST_BUTTON_TEXT = "\u0421\u043e\u0437\u0434\u0430\u0442\u044c \u0430\u043a\u0442 (\u0442\u0435\u0441\u0442\u043e\u0432\u044b\u0439 \u0440\u0435\u0436\u0438\u043c)";
const ACT_TEST_BOT_START_BASE_URL = "https://max.ru/id164802161000_5_bot?start=";
const RU_START_DONE_NO_PENDING =
  "\u041a\u043e\u043c\u0430\u043d\u0434\u0430 /start \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430. \u041d\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043d\u044b\u0445 \u0437\u0430\u044f\u0432\u043e\u043a \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e.";
const SUBMISSION_WINDOW_CLOSED_TEXT =
  "Submission window is closed. Sending and confirming data is allowed only from 00:01 to 21:59 MSK.";

type EventActionKind = "confirm" | "cancel" | "topup" | "topup_cancel" | "none";

function pickFirstNonEmpty(...candidates: unknown[]) {
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

function isStartCommand(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^\/start(?:@\w+)?(?:\s|$)/i.test(normalized);
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
              text: RU_CANCEL,
              payload: `cancel_submission:${submissionId}`
            }
          ]
        ]
      }
    }
  ];
}

function topupPackagesCancelKeyboard() {
  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "message",
              text: RU_CANCEL_SHORT,
              payload: TOPUP_CANCEL_CALLBACK_PAYLOAD
            }
          ]
        ]
      }
    }
  ];
}

function createActTestKeyboard(submissionId: string) {
  const actUrl = `${ACT_TEST_BOT_START_BASE_URL}${encodeURIComponent(submissionId)}`;

  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "link",
              text: ACT_TEST_BUTTON_TEXT,
              url: actUrl
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

function pickImageUrl(attachments: any[]) {
  const urls = extractUrlsDeep(attachments, []);
  const preferred = urls.find((item) => /\.(jpg|jpeg|png|webp)(\?|$)/i.test(item));
  return preferred || urls[0] || "";
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

function parseActionToken(value: string): { kind: EventActionKind; submissionId: string } {
  if (!value) {
    return { kind: "none", submissionId: "" };
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  const lowered = normalized.toLowerCase();

  if (lowered === "topup_balance" || lowered === RU_TOPUP_BALANCE) {
    return { kind: "topup", submissionId: "" };
  }

  if (lowered === TOPUP_CANCEL_CALLBACK_PAYLOAD) {
    return { kind: "topup_cancel", submissionId: "" };
  }

  if (lowered === "confirm" || lowered === RU_CONFIRM) {
    return { kind: "confirm", submissionId: "" };
  }

  if (lowered === "cancel" || lowered === RU_CANCEL) {
    return { kind: "cancel", submissionId: "" };
  }

  if (normalized.startsWith("confirm_submission:")) {
    return { kind: "confirm", submissionId: normalized.slice("confirm_submission:".length).trim() };
  }

  if (normalized.startsWith("cancel_submission:")) {
    return { kind: "cancel", submissionId: normalized.slice("cancel_submission:".length).trim() };
  }

  return { kind: "none", submissionId: "" };
}

function parseActionTokenFromUnknown(value: unknown, depth = 0): { kind: EventActionKind; submissionId: string } {
  if (depth > 8 || value == null) {
    return { kind: "none", submissionId: "" };
  }

  if (typeof value === "string") {
    const fromText = parseActionToken(value);
    if (fromText.kind !== "none") {
      return fromText;
    }

    const trimmed = value.trim();
    if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
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
    const candidateKeys = ["payload", "text", "data", "command", "action", "value", "callback", "callback_data", "message"];
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

async function sendProfileMessage(userId: bigint, fallbackUserIdText?: string) {
  const profile = await getUserProfilePayload(userId);
  if (!profile) {
    if (fallbackUserIdText) {
      await maxBotClient.sendMessage({
        userId: fallbackUserIdText,
        text: unknownUserMessage(fallbackUserIdText),
        format: "html"
      });
    }
    return null;
  }

  await maxBotClient.sendMessage({
    userId: userId.toString(),
    text: profile.text,
    attachments: profile.attachments,
    format: profile.format
  });

  return profile;
}

async function handleConfirmAction(input: {
  submissionId: string;
  userId: string;
  callbackId?: string;
  req: any;
}) {
  if (!isSubmissionWindowOpen()) {
    await maxBotClient.sendMessage({
      userId: input.userId,
      text: SUBMISSION_WINDOW_CLOSED_TEXT
    });

    if (input.callbackId) {
      await maxBotClient.answerCallback({
        callbackId: input.callbackId,
        notification: "Submission window is closed"
      });
    }
    return;
  }

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
      notification: RU_NOTIFY_ATTACH_PHOTO
    });
  }
}

async function handleCancelAction(input: {
  submissionId: string;
  userId: string;
  numericUserId: bigint;
  callbackId?: string;
  req: any;
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
    text: submissionCancelledMessage()
  });

  await sendProfileMessage(input.numericUserId, input.userId);

  if (input.callbackId) {
    await maxBotClient.answerCallback({
      callbackId: input.callbackId,
      notification: RU_NOTIFY_SUBMISSION_CANCELLED
    });
  }
}

async function handleStartCommand(input: { userId: string; numericUserId: bigint; req: any }) {
  const cancelled = await cancelAllUnfinishedSubmissions({ userId: input.userId });

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
      ? `\u041a\u043e\u043c\u0430\u043d\u0434\u0430 /start \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0430. \u041e\u0442\u043c\u0435\u043d\u0435\u043d\u043e \u043d\u0435\u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043d\u044b\u0445 \u0437\u0430\u044f\u0432\u043e\u043a: ${cancelled.cancelledCount}.`
      : RU_START_DONE_NO_PENDING;

  await maxBotClient.sendMessage({
    userId: input.userId,
    text: prefix
  });

  await sendProfileMessage(input.numericUserId, input.userId);
}

async function handleTopupAction(input: { userId: string; numericUserId: bigint; callbackId?: string }) {
  const activeTopup = await getActiveTopupForUser(input.numericUserId);
  if (activeTopup) {
    await setBotUserState(input.numericUserId, BOT_STATE_ACTIVE_TOPUP_PENDING, { topupId: activeTopup.id });
    await maxBotClient.sendMessage({
      userId: input.userId,
      text: getActiveTopupUserMessage(activeTopup)
    });

    if (input.callbackId) {
      await maxBotClient.answerCallback({
        callbackId: input.callbackId,
        notification: RU_NOTIFY_ACTIVE_TOPUP_EXISTS
      });
    }
    return;
  }

  await setBotUserState(input.numericUserId, BOT_STATE_AWAITING_TOPUP_PACKAGES);
  await maxBotClient.sendMessage({
    userId: input.userId,
    text: RU_TEXT_HOW_MANY_PACKAGES,
    attachments: topupPackagesCancelKeyboard()
  });

  if (input.callbackId) {
    await maxBotClient.answerCallback({
      callbackId: input.callbackId,
      notification: RU_NOTIFY_ENTER_PACKAGES
    });
  }
}

async function handleTopupCancelAction(input: { userId: string; numericUserId: bigint; callbackId?: string }) {
  const activeTopup = await getActiveTopupForUser(input.numericUserId);
  if (activeTopup) {
    await setBotUserState(input.numericUserId, BOT_STATE_ACTIVE_TOPUP_PENDING, { topupId: activeTopup.id });
    await maxBotClient.sendMessage({
      userId: input.userId,
      text: getActiveTopupUserMessage(activeTopup)
    });

    if (input.callbackId) {
      await maxBotClient.answerCallback({
        callbackId: input.callbackId,
        notification: RU_NOTIFY_ACTIVE_TOPUP_EXISTS
      });
    }
    return;
  }

  const userState = await getBotUserState(input.numericUserId);
  if (userState?.state === BOT_STATE_AWAITING_TOPUP_PACKAGES) {
    await clearBotUserState(input.numericUserId);
    await maxBotClient.sendMessage({
      userId: input.userId,
      text: RU_TEXT_TOPUP_SCENARIO_CANCELLED
    });
    await sendProfileMessage(input.numericUserId, input.userId);

    if (input.callbackId) {
      await maxBotClient.answerCallback({
        callbackId: input.callbackId,
        notification: RU_NOTIFY_TOPUP_CANCELLED
      });
    }
    return;
  }

  if (input.callbackId) {
    await maxBotClient.answerCallback({
      callbackId: input.callbackId,
      notification: RU_NOTIFY_SCENARIO_ALREADY_FINISHED
    });
  }
}
async function handleTopupPackagesInput(input: { userId: string; numericUserId: bigint; text: string }) {
  const packagesCount = parsePackagesCountFromText(input.text);
  if (packagesCount == null) {
    await maxBotClient.sendMessage({
      userId: input.userId,
      text: `\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u0446\u0435\u043b\u043e\u0435 \u0447\u0438\u0441\u043b\u043e \u043f\u0430\u043a\u0435\u0442\u043e\u0432 \u043e\u0442 ${env.PAYMENT_MIN_PACKAGES_PER_TOPUP} \u0434\u043e ${env.PAYMENT_MAX_PACKAGES_PER_TOPUP}.`
    });
    return;
  }

  try {
    const created = await createOrReuseTopupForUser({
      userIdRaw: input.userId,
      packagesCount
    });

    await setBotUserState(input.numericUserId, BOT_STATE_ACTIVE_TOPUP_PENDING, { topupId: created.topup.id });

    await maxBotClient.sendMessage({
      userId: input.userId,
      text: created.reused ? getActiveTopupUserMessage(created.topup) : getTopupPaymentLinkMessage(created.topup)
    });
  } catch (error) {
    if (error instanceof AppError) {
      await maxBotClient.sendMessage({
        userId: input.userId,
        text: error.message
      });
      return;
    }
    throw error;
  }
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
        text: unknownUserMessage(event.userId),
        format: "html"
      });
      return res.json({ ok: true });
    }

    const user = await prisma.user.findUnique({
      where: { id: numericUserId },
      select: { id: true, role: true }
    });
    if (!user) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: unknownUserMessage(event.userId),
        format: "html"
      });
      return res.json({ ok: true });
    }

    if (user.role === UserRole.ADMIN) {
      if (event.type !== "message_created") {
        if (event.callbackId) {
          await maxBotClient.answerCallback({
            callbackId: event.callbackId,
            notification: "\u0410\u0434\u043c\u0438\u043d-\u043a\u043e\u043c\u0430\u043d\u0434\u044b \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u044e\u0442\u0441\u044f \u0442\u043e\u043b\u044c\u043a\u043e \u0442\u0435\u043a\u0441\u0442\u043e\u043c. \u041d\u0430\u043f\u0438\u0448\u0438 /start."
          });
        }
        return res.json({ ok: true, skipped: "ADMIN_EVENT_NOT_SUPPORTED" });
      }

      await handleAdminCommand({
        adminUserId: user.id,
        userIdText: event.userId,
        text: event.text,
        req
      });
      return res.json({ ok: true, handled: "ADMIN_COMMAND" });
    }

    if (event.type === "message_created" && isAdminCommandText(event.text)) {
      await sendAdminAccessDenied(event.userId);
      return res.json({ ok: true, handled: "ADMIN_ACCESS_DENIED" });
    }

    const isCallbackEvent = event.type === "message_callback" || Boolean(event.callbackId);

    if (isCallbackEvent) {
      const action = resolveActionFromEvent(event, req.body);
      const loweredText = event.text.trim().toLowerCase();

      if (action.kind === "topup_cancel" || loweredText === RU_CANCEL_SHORT) {
        await handleTopupCancelAction({
          userId: event.userId,
          numericUserId,
          callbackId: event.callbackId || undefined
        });
        return res.json({ ok: true, handled: "TOPUP_CANCEL" });
      }

      if (action.kind === "topup") {
        await handleTopupAction({
          userId: event.userId,
          numericUserId,
          callbackId: event.callbackId || undefined
        });
        return res.json({ ok: true, handled: "TOPUP_ACTION" });
      }

      const activeTopup = await getActiveTopupForUser(numericUserId);
      if (activeTopup) {
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: getActiveTopupUserMessage(activeTopup)
        });

        if (event.callbackId) {
          await maxBotClient.answerCallback({
            callbackId: event.callbackId,
            notification: RU_NOTIFY_ACTIVE_TOPUP_EXISTS
          });
        }

        return res.json({ ok: true, handled: "ACTIVE_TOPUP_BLOCK" });
      }

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
          numericUserId,
          callbackId: event.callbackId || undefined,
          req
        });
        return res.json({ ok: true, handled: "SUBMISSION_CANCELLED" });
      }

      if (action.kind !== "none" && !actionSubmissionId) {
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: noPendingSubmissionMessage()
        });
        await sendProfileMessage(numericUserId, event.userId);

        if (event.callbackId) {
          await maxBotClient.answerCallback({
            callbackId: event.callbackId,
            notification: RU_NOTIFY_NO_PENDING_FOR_ACTION
          });
        }

        return res.json({ ok: true, handled: "NO_PENDING_SUBMISSION" });
      }

      if (event.callbackId) {
        await maxBotClient.answerCallback({
          callbackId: event.callbackId,
          notification: RU_NOTIFY_UNKNOWN_ACTION
        });
      }

      return res.json({ ok: true, skipped: "CALLBACK_NOT_HANDLED" });
    }

    if (event.type !== "message_created") {
      return res.json({ ok: true, skipped: "EVENT_TYPE_NOT_SUPPORTED" });
    }

    const userState = await getBotUserState(numericUserId);

    if (userState?.state === BOT_STATE_ACTIVE_TOPUP_PENDING) {
      const activeTopup = await getActiveTopupForUser(numericUserId);
      if (!activeTopup) {
        await clearBotUserState(numericUserId);
      }
    }

    if (userState?.state === BOT_STATE_AWAITING_TOPUP_PACKAGES) {
      const awaitingTopupAction = resolveActionFromEvent(event, req.body);
      const loweredText = event.text.trim().toLowerCase();
      if (awaitingTopupAction.kind === "topup_cancel" || loweredText === RU_CANCEL_SHORT) {
        await handleTopupCancelAction({
          userId: event.userId,
          numericUserId
        });
        return res.json({ ok: true, handled: "TOPUP_CANCEL" });
      }

      const activeTopup = await getActiveTopupForUser(numericUserId);
      if (activeTopup) {
        await clearBotUserState(numericUserId);
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: getActiveTopupUserMessage(activeTopup)
        });
        return res.json({ ok: true, handled: "TOPUP_ALREADY_ACTIVE" });
      }

      await handleTopupPackagesInput({
        userId: event.userId,
        numericUserId,
        text: event.text
      });

      return res.json({ ok: true, handled: "TOPUP_PACKAGES_INPUT" });
    }

    const messageAction = resolveActionFromEvent(event, req.body);
    if (messageAction.kind === "topup") {
      await handleTopupAction({
        userId: event.userId,
        numericUserId
      });
      return res.json({ ok: true, handled: "TOPUP_ACTION" });
    }

    const activeTopup = await getActiveTopupForUser(numericUserId);
    if (activeTopup) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: getActiveTopupUserMessage(activeTopup)
      });
      return res.json({ ok: true, handled: "ACTIVE_TOPUP_BLOCK" });
    }

    if (isStartCommand(event.text)) {
      await clearBotUserState(numericUserId);
      await handleStartCommand({
        userId: event.userId,
        numericUserId,
        req
      });
      return res.json({ ok: true, handled: "START_RESET" });
    }

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
        numericUserId,
        req
      });
      return res.json({ ok: true, handled: "SUBMISSION_CANCELLED" });
    }

    if (messageAction.kind !== "none" && !messageActionSubmissionId) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: noPendingSubmissionMessage()
      });
      await sendProfileMessage(numericUserId, event.userId);
      return res.json({ ok: true, handled: "NO_PENDING_SUBMISSION" });
    }

    const awaiting = await getAwaitingPhotoSubmission(event.userId);
    if (awaiting) {
      if (!isSubmissionWindowOpen()) {
        await maxBotClient.sendMessage({
          userId: event.userId,
          text: SUBMISSION_WINDOW_CLOSED_TEXT
        });
        return res.json({ ok: true, handled: "SUBMISSION_WINDOW_CLOSED" });
      }

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

      try {
        await confirmSubmission({
          submissionId: awaiting.id,
          actorUserId: event.userId,
          actorRole: "USER"
        });
      } catch (error) {
        if (error instanceof AppError && error.code === "INSUFFICIENT_BALANCE") {
          const files = await prisma.fileEntity.findMany({
            where: { submissionId: awaiting.id },
            select: { storageKey: true }
          });
          await prisma.fileEntity.deleteMany({ where: { submissionId: awaiting.id } });

          const storageKeys = Array.from(new Set([...files.map((item) => item.storageKey), stored.storageKey]));
          for (const storageKey of storageKeys) {
            try {
              await storageProvider.deleteFile(storageKey);
            } catch (deleteError) {
              logger.warn({ err: deleteError, storageKey }, "Failed to delete file after insufficient balance");
            }
          }

          await rejectSubmissionForInsufficientBalance({
            submissionId: awaiting.id,
            userId: event.userId
          });

          await logAuditEvent({
            actorUserId: event.userId,
            action: "bot.submission.rejected.insufficient_balance",
            entityType: "SUBMISSION",
            entityId: awaiting.id,
            req
          });

          await maxBotClient.sendMessage({
            userId: event.userId,
            text: insufficientBalanceMessage()
          });

          await sendProfileMessage(numericUserId, event.userId);

          return res.json({ ok: true, handled: "SUBMISSION_REJECTED_INSUFFICIENT_BALANCE" });
        }

        throw error;
      }

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
        text: photoSavedAndConfirmedMessage(),
        attachments: createActTestKeyboard(awaiting.id)
      });

      await sendProfileMessage(numericUserId, event.userId);
      return res.json({ ok: true, handled: "SUBMISSION_CONFIRMED_WITH_PHOTO" });
    }

    const freshProfile = await sendProfileMessage(numericUserId, event.userId);

    await logAuditEvent({
      actorUserId: user.id,
      action: "bot.unexpected.message.reply.sent",
      entityType: "SYSTEM",
      meta: {
        eventType: event.type,
        remainingPackages: freshProfile?.remainingPackages ?? "0"
      },
      req
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export { router as botRoutes };
