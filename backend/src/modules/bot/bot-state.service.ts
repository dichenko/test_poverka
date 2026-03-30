import { Prisma } from "@prisma/client";
import { prisma } from "../../common/prisma";

export const BOT_STATE_AWAITING_TOPUP_PACKAGES = "awaiting_topup_packages";
export const BOT_STATE_ACTIVE_TOPUP_PENDING = "active_topup_pending";

export async function getBotUserState(userId: bigint) {
  return prisma.botUserState.findUnique({
    where: { userId }
  });
}

export async function setBotUserState(userId: bigint, state: string, payload?: Record<string, unknown>) {
  const normalizedPayload = payload as Prisma.InputJsonValue | undefined;
  return prisma.botUserState.upsert({
    where: { userId },
    create: {
      userId,
      state,
      payload: normalizedPayload
    },
    update: {
      state,
      payload: normalizedPayload
    }
  });
}

export async function clearBotUserState(userId: bigint) {
  await prisma.botUserState.deleteMany({
    where: { userId }
  });
}
