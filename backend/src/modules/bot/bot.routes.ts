import { SubmissionStatus } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { authRateLimit } from "../../middlewares/rate-limit";
import { logAuditEvent } from "../../services/audit.service";
import { confirmSubmission } from "../submissions/submissions.service";
import { maxBotClient } from "./max-bot.client";
import {
  miniappOpenMessage,
  noPendingSubmissionMessage,
  submissionConfirmedMessage,
  unknownUserMessage
} from "./bot.templates";

const router = Router();
const MAX_LOG_TEXT_LIMIT = 500;

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

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
    body?.payload?.sender?.user_id
  );
  const text = pickFirstNonEmpty(
    body?.text,
    body?.message?.text,
    body?.message?.body?.text,
    body?.message?.body,
    body?.payload?.text,
    body?.payload?.message?.text
  );

  return {
    type,
    userId,
    text
  };
}

function isConfirmCommand(text: string) {
  const normalized = normalizeText(text);
  return normalized === "подтверждаю" || normalized === "confirm";
}

function formatIncomingLog(userId: string, text: string) {
  const now = new Date().toISOString();
  const safeText = text.replace(/\s+/g, " ").trim().slice(0, MAX_LOG_TEXT_LIMIT);
  return `${now} - ${userId || "-"} - ${safeText || "-"}`;
}

router.post("/webhook/max", authRateLimit, async (req, res, next) => {
  try {
    const secret = req.header("X-Max-Bot-Api-Secret");
    if (!secret || secret !== env.MAX_WEBHOOK_SECRET) {
      throw new AppError("Invalid X-Max-Bot-Api-Secret header.", 401, "WEBHOOK_SECRET_INVALID");
    }

    const event = extractEvent(req.body);
    logger.info({ eventType: event.type }, formatIncomingLog(event.userId, event.text));

    if (!event.userId) {
      logger.warn(
        { eventType: event.type, topLevelKeys: Object.keys(req.body ?? {}) },
        "MAX webhook event skipped: missing user id"
      );
      return res.json({ ok: true, skipped: "WEBHOOK_USER_MISSING" });
    }

    const user = await prisma.user.findUnique({
      where: { maxUserId: event.userId }
    });
    if (!user || !user.isActive) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: unknownUserMessage(event.userId)
      });
      return res.json({ ok: true });
    }

    if (event.type === "bot_started" || !isConfirmCommand(event.text)) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: miniappOpenMessage(user.fullName),
        miniappUrl: env.MINIAPP_PUBLIC_URL
      });

      await logAuditEvent({
        actorUserId: user.id,
        action: "bot.miniapp.link.sent",
        entityType: "SYSTEM",
        req
      });

      return res.json({ ok: true });
    }

    const pending = await prisma.meterSubmission.findFirst({
      where: {
        userId: user.id,
        status: SubmissionStatus.PENDING_CONFIRMATION
      },
      orderBy: { createdAt: "desc" }
    });

    if (!pending) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: noPendingSubmissionMessage()
      });
      return res.json({ ok: true });
    }

    await confirmSubmission({
      submissionId: pending.id,
      actorUserId: user.id,
      actorRole: user.role
    });

    await maxBotClient.sendMessage({
      userId: event.userId,
      text: submissionConfirmedMessage()
    });

    await logAuditEvent({
      actorUserId: user.id,
      action: "bot.submission.confirmed",
      entityType: "SUBMISSION",
      entityId: pending.id,
      req
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export { router as botRoutes };
