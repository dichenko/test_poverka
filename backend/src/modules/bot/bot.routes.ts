import { Router } from "express";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { authRateLimit } from "../../middlewares/rate-limit";
import { logAuditEvent } from "../../services/audit.service";
import { maxBotClient } from "./max-bot.client";
import { knownUserUnexpectedMessage, unknownUserMessage } from "./bot.templates";

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

    const user = await prisma.user.findUnique({
      where: { id: numericUserId },
      include: { organization: true }
    });

    if (!user) {
      await maxBotClient.sendMessage({
        userId: event.userId,
        text: unknownUserMessage(event.userId)
      });
      return res.json({ ok: true });
    }

    const tarif = user.userTarif ?? user.organization?.userTarif;
    const remainingPackages = formatRemainingPackages(user.organization?.balance, tarif);

    await maxBotClient.sendMessage({
      userId: event.userId,
      text: knownUserUnexpectedMessage(event.userId, remainingPackages)
    });

    await logAuditEvent({
      actorUserId: user.id,
      action: "bot.unexpected.message.reply.sent",
      entityType: "SYSTEM",
      meta: {
        eventType: event.type,
        remainingPackages
      },
      req
    });

    return res.json({ ok: true });
  } catch (error) {
    return next(error);
  }
});

export { router as botRoutes };
