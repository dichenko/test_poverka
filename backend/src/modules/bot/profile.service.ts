import { maxBotClient } from "./max-bot.client";
import { prisma } from "../../common/prisma";
import { buildUserProfileMessage } from "./profile.builder";

function formatRemainingPackages(balanceRubles: bigint, tariffRubles: bigint): string {
  if (balanceRubles <= 0n || tariffRubles <= 0n) {
    return "0";
  }

  const scaled = (balanceRubles * 10n) / tariffRubles;
  const integerPart = scaled / 10n;
  const fraction = scaled % 10n;
  if (fraction === 0n) {
    return integerPart.toString();
  }
  return `${integerPart.toString()}.${fraction.toString()}`;
}

export interface UserProfilePayload {
  user: {
    id: bigint;
    fullName: string;
    organizationName: string | null;
  };
  remainingPackages: string;
  text: string;
  attachments: Array<Record<string, any>>;
}

export async function getUserProfilePayload(userId: bigint): Promise<UserProfilePayload | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true }
  });

  if (!user) {
    return null;
  }

  const organizationBalanceRubles = user.organization?.balance ?? 0n;
  const tariffRubles = user.organization?.userTarif ?? 0n;

  const remainingPackages = formatRemainingPackages(organizationBalanceRubles, tariffRubles);

  const profile = buildUserProfileMessage({
    maxUserId: user.id.toString(),
    fullName: user.fullName,
    organizationName: user.organization?.name ?? null,
    remainingPackages
  });

  return {
    user: {
      id: user.id,
      fullName: user.fullName,
      organizationName: user.organization?.name ?? null
    },
    remainingPackages,
    text: profile.text,
    attachments: profile.attachments
  };
}

export async function sendUserProfileMessage(userId: string | bigint) {
  const numericUserId = typeof userId === "bigint" ? userId : BigInt(userId);
  const profile = await getUserProfilePayload(numericUserId);
  if (!profile) {
    return { ok: false as const, reason: "USER_NOT_FOUND" };
  }

  const sent = await maxBotClient.sendMessage({
    userId: numericUserId.toString(),
    text: profile.text,
    attachments: profile.attachments
  });

  return {
    ok: sent.ok,
    profile
  };
}
