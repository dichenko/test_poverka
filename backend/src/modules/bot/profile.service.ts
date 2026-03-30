import { maxBotClient } from "./max-bot.client";
import { prisma } from "../../common/prisma";
import { buildUserProfileMessage } from "./profile.builder";

function legacyRublesToKopecks(value: number | null | undefined): bigint {
  if (value == null || !Number.isFinite(value)) {
    return 0n;
  }
  return BigInt(Math.max(0, Math.round(value * 100)));
}

function resolveTariffKopecks(input: {
  organizationTariffKopecks: bigint;
  organizationTariffLegacy: number | null;
}): bigint {
  if (
    input.organizationTariffLegacy != null &&
    Number.isFinite(input.organizationTariffLegacy) &&
    input.organizationTariffLegacy > 0
  ) {
    return legacyRublesToKopecks(input.organizationTariffLegacy);
  }
  if (input.organizationTariffKopecks > 0n) {
    return input.organizationTariffKopecks;
  }
  return 0n;
}

function formatRemainingPackages(balanceKopecks: bigint, tariffKopecks: bigint): string {
  if (balanceKopecks <= 0n || tariffKopecks <= 0n) {
    return "0";
  }

  const ratio = Number(balanceKopecks) / Number(tariffKopecks);
  if (!Number.isFinite(ratio) || ratio < 0) {
    return "0";
  }

  return ratio.toFixed(1).replace(/\.0$/, "");
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

  const organizationBalanceKopecks = user.organization?.balanceKopecks ?? legacyRublesToKopecks(user.organization?.balance);
  const tariffKopecks = resolveTariffKopecks({
    organizationTariffKopecks: user.organization?.tariffPerPackageKopecks ?? 0n,
    organizationTariffLegacy: user.organization?.userTarif ?? null
  });

  const remainingPackages = formatRemainingPackages(organizationBalanceKopecks, tariffKopecks);

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
