import { SubmissionStatus } from "@prisma/client";
import { Router } from "express";
import { AppError } from "../../common/app-error";
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

function normalizeText(input: unknown): string {
  return String(input ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function extractEvent(body: any) {
  const type = body?.update_type ?? body?.type ?? "";
  const userId =
    body?.user_id ??
    body?.user?.id ??
    body?.from?.id ??
    body?.message?.from?.id ??
    body?.message?.sender?.id ??
    body?.payload?.user_id;
  const text = body?.text ?? body?.message?.text ?? body?.message?.body?.text ?? body?.payload?.text ?? "";
  return {
    type: String(type || "message_created"),
    userId: String(userId || "").trim(),
    text: String(text || "").trim()
  };
}

function isConfirmCommand(text: string) {
  const normalized = normalizeText(text);
  return normalized === "подтверждаю" || normalized === "confirm";
}

router.post("/webhook/max", authRateLimit, async (req, res, next) => {
  try {
    const secret = req.header("X-Max-Bot-Api-Secret");
    if (!secret || secret !== env.MAX_WEBHOOK_SECRET) {
      throw new AppError("Invalid X-Max-Bot-Api-Secret header.", 401, "WEBHOOK_SECRET_INVALID");
    }

    const event = extractEvent(req.body);
    if (!event.userId) {
      throw new AppError("Missing user id in webhook payload.", 400, "WEBHOOK_USER_MISSING");
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
