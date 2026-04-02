import { Prisma } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { clearBotUserState } from "../bot/bot-state.service";
import { maxBotClient } from "../bot/max-bot.client";
import { getUserProfilePayload } from "../bot/profile.service";
import { ACTIVE_TOPUP_STATUSES, PAYMENT_ERROR_CODES, TOPUP_STATUS } from "./payments.constants";
import {
  formatRubles,
  rublesToYookassaAmount,
  parseYookassaAmountToRubles
} from "./money";
import { YookassaHttpError, type YookassaPayment, yookassaClient } from "./yookassa.client";

const USER_TOPUP_LINK_TTL_MINUTES = Math.ceil(env.TOPUP_LINK_TTL_SECONDS / 60);
const YOOKASSA_PAYMENT_DESCRIPTION = "Организация работ по поверке";

type TopupWithRelations = Prisma.OrganizationTopupGetPayload<{
  include: {
    user: true;
    organization: true;
  };
}>;

interface CreateTopupResult {
  topup: TopupWithRelations;
  reused: boolean;
}

interface FinalizeTopupResult {
  credited: boolean;
  topupId: string;
  userId: bigint;
}

type FinalizationOutcome = "paid" | "canceled" | "expired";

function parseUserId(raw: string | bigint) {
  if (typeof raw === "bigint") {
    return raw;
  }
  try {
    return BigInt(raw);
  } catch {
    throw new AppError("Invalid user id.", 400, "USER_ID_INVALID");
  }
}

function parseDateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function truncateErrorMessage(value: unknown, maxLength = 1024) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text.slice(0, maxLength);
}

function resolveTariffPerPackageRubles(organizationUserTarif: bigint) {
  if (organizationUserTarif > 0n) {
    return organizationUserTarif;
  }
  return 0n;
}

function normalizeEmail(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizePhone(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  const hasPlus = raw.startsWith("+");
  let digits = raw.replace(/\D+/g, "");
  if (!digits) {
    return null;
  }

  if (!hasPlus && digits.length === 10) {
    digits = `7${digits}`;
  }

  if (!hasPlus && digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }

  if (digits.length < 10 || digits.length > 15) {
    return null;
  }

  return `+${digits}`;
}

function resolveReceiptCustomer(input: {
  userPhone: string | null;
  userOrgEmail: string | null;
  organizationEmail: string | null;
}) {
  const email = normalizeEmail(input.organizationEmail) ?? normalizeEmail(input.userOrgEmail);
  const phone = normalizePhone(input.userPhone);

  if (!email && !phone) {
    throw new AppError(
      "Не удалось сформировать чек для оплаты: нужен email организации или телефон пользователя.",
      409,
      PAYMENT_ERROR_CODES.TOPUP_RECEIPT_CONTACT_REQUIRED
    );
  }

  return {
    ...(email ? { email } : {}),
    ...(phone ? { phone } : {})
  };
}

function formatMoscowDateTime(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  }).format(value);
}

function toBackoffDelaySeconds(attempts: number) {
  const clampedAttempts = Math.max(1, attempts);
  const computed = env.PAYMENT_POLL_BACKOFF_BASE_SECONDS * 2 ** (clampedAttempts - 1);
  return Math.min(computed, env.PAYMENT_POLL_BACKOFF_MAX_SECONDS);
}

function isActiveTopupUniqueViolation(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2002") {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("organization_topups_active_user_unique") || message.includes("organization_topups_user_id_key");
}

function validatePackagesCount(packagesCount: number) {
  if (!Number.isInteger(packagesCount) || packagesCount <= 0) {
    throw new AppError("Введите целое положительное число пакетов.", 400, PAYMENT_ERROR_CODES.TOPUP_INVALID_PACKAGES_COUNT);
  }

  if (packagesCount < env.PAYMENT_MIN_PACKAGES_PER_TOPUP || packagesCount > env.PAYMENT_MAX_PACKAGES_PER_TOPUP) {
    throw new AppError(
      `Количество пакетов должно быть от ${env.PAYMENT_MIN_PACKAGES_PER_TOPUP} до ${env.PAYMENT_MAX_PACKAGES_PER_TOPUP}.`,
      400,
      PAYMENT_ERROR_CODES.TOPUP_INVALID_PACKAGES_COUNT
    );
  }
}

function normalizeCancelOutcome(input: {
  providerReason?: string | null;
  topupExpiresAt: Date;
  now: Date;
}): { terminalStatus: "expired" | "canceled"; reasonCode: string; reasonText: string } {
  const reason = String(input.providerReason || "").trim().toLowerCase();
  const expiredByReason = reason.includes("expired") || reason.includes("timeout");
  const expiredByTime = input.topupExpiresAt.getTime() <= input.now.getTime();

  if (expiredByReason || expiredByTime) {
    return {
      terminalStatus: TOPUP_STATUS.EXPIRED,
      reasonCode: reason || "expired_local_timeout",
      reasonText: reason || "Topup link expired"
    };
  }

  return {
    terminalStatus: TOPUP_STATUS.CANCELED,
    reasonCode: reason || "payment_canceled",
    reasonText: reason || "Payment canceled"
  };
}

async function sendTopupFinalizedMessages(input: { userId: bigint; outcome: FinalizationOutcome }) {
  if (input.outcome === "paid") {
    await maxBotClient.sendMessage({
      userId: input.userId.toString(),
      text: "Платеж прошел, средства зачислены на ваш счет"
    });
  } else if (input.outcome === "canceled") {
    await maxBotClient.sendMessage({
      userId: input.userId.toString(),
      text: "Платеж отменен"
    });
  } else {
    await maxBotClient.sendMessage({
      userId: input.userId.toString(),
      text: "Время оплаты истекло, платеж отменен"
    });
  }

  await clearBotUserState(input.userId);

  const profile = await getUserProfilePayload(input.userId);
  if (!profile) {
    return;
  }

  await maxBotClient.sendMessage({
    userId: input.userId.toString(),
    text: profile.text,
    attachments: profile.attachments,
    format: profile.format
  });
}

export function parsePackagesCountFromText(rawText: string) {
  const normalized = rawText.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  return parsed;
}

export function getTopupPaymentLinkMessage(topup: {
  amountRubles: bigint;
  providerConfirmationUrl: string | null;
}) {
  const url = topup.providerConfirmationUrl || "(ссылка недоступна)";
  return `Для оплаты пройдите по ссылке: ${url}\nВремя для оплаты: ${USER_TOPUP_LINK_TTL_MINUTES} минуты, после этого ссылка становится недействительной.`;
}

export function getActiveTopupUserMessage(topup: {
  amountRubles: bigint;
  providerConfirmationUrl: string | null;
  expiresAt: Date;
}) {
  const amountRub = formatRubles(topup.amountRubles);
  const url = topup.providerConfirmationUrl || "(ссылка недоступна)";
  const expiresAt = formatMoscowDateTime(topup.expiresAt);

  return `У тебя есть незавершенный платеж на ${amountRub}.\nОплати его по ссылке: ${url}\nСрок действия до ${expiresAt}.`;
}

export async function getActiveTopupForUser(userIdRaw: string | bigint) {
  const userId = parseUserId(userIdRaw);
  return prisma.organizationTopup.findFirst({
    where: {
      userId,
      status: {
        in: ACTIVE_TOPUP_STATUSES
      }
    },
    include: {
      user: true,
      organization: true
    },
    orderBy: {
      createdAt: "desc"
    }
  });
}

export async function assertNoActiveTopupForUser(userIdRaw: string | bigint) {
  const activeTopup = await getActiveTopupForUser(userIdRaw);
  if (!activeTopup) {
    return;
  }

  throw new AppError(getActiveTopupUserMessage(activeTopup), 409, PAYMENT_ERROR_CODES.ACTIVE_TOPUP_PENDING, {
    topupId: activeTopup.id,
    amountRubles: activeTopup.amountRubles.toString(),
    providerConfirmationUrl: activeTopup.providerConfirmationUrl,
    expiresAt: activeTopup.expiresAt.toISOString()
  });
}

export async function createOrReuseTopupForUser(input: {
  userIdRaw: string | bigint;
  packagesCount: number;
}): Promise<CreateTopupResult> {
  validatePackagesCount(input.packagesCount);

  const userId = parseUserId(input.userIdRaw);
  const existing = await getActiveTopupForUser(userId);
  if (existing) {
    return {
      topup: existing,
      reused: true
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true }
  });

  if (!user) {
    throw new AppError("User not found.", 404, "USER_NOT_FOUND");
  }

  if (!user.organizationId || !user.organization) {
    throw new AppError("Organization is required for topup.", 409, "ORG_REQUIRED");
  }

  const tariffPerPackageRubles = resolveTariffPerPackageRubles(user.organization.userTarif);

  if (tariffPerPackageRubles <= 0n) {
    throw new AppError("Тариф организации не настроен.", 409, "ORG_TARIFF_NOT_CONFIGURED");
  }

  const amountRubles = BigInt(input.packagesCount) * tariffPerPackageRubles;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.TOPUP_LINK_TTL_SECONDS * 1000);
  const idempotenceKey = yookassaClient.generateIdempotenceKey();

  let topup: TopupWithRelations | null = null;

  try {
    topup = await prisma.organizationTopup.create({
      data: {
        organizationId: user.organizationId,
        userId,
        status: TOPUP_STATUS.AWAITING_PAYMENT,
        packagesCount: input.packagesCount,
        tariffPerPackageRubles,
        amountRubles,
        currency: env.YOOKASSA_CURRENCY,
        provider: "yookassa",
        providerStatus: "created_local",
        providerIdempotenceKey: idempotenceKey,
        expiresAt,
        nextPollAt: now,
        pollAttempts: 0
      },
      include: {
        user: true,
        organization: true
      }
    });
  } catch (error) {
    if (!isActiveTopupUniqueViolation(error)) {
      throw error;
    }

    const activeAfterRace = await getActiveTopupForUser(userId);
    if (!activeAfterRace) {
      throw error;
    }

    return {
      topup: activeAfterRace,
      reused: true
    };
  }

  try {
    const description = YOOKASSA_PAYMENT_DESCRIPTION;

    const amountValue = rublesToYookassaAmount(amountRubles);
    const receiptCustomer = resolveReceiptCustomer({
      userPhone: user.phone,
      userOrgEmail: user.orgEmail,
      organizationEmail: user.organization.email
    });

    const payment = await yookassaClient.createPayment(
      {
        amount: {
          value: amountValue,
          currency: env.YOOKASSA_CURRENCY
        },
        capture: true,
        confirmation: {
          type: "redirect",
          return_url: env.YOOKASSA_RETURN_URL
        },
        description,
        metadata: {
          organization_id: user.organizationId.toString(),
          user_id: user.id.toString(),
          packages_count: String(input.packagesCount),
          tariff_per_package_rubles: tariffPerPackageRubles.toString(),
          internal_topup_id: topup.id
        },
        receipt: {
          customer: receiptCustomer,
          items: [
            {
              description,
              quantity: "1.00",
              amount: {
                value: amountValue,
                currency: env.YOOKASSA_CURRENCY
              },
              vat_code: env.YOOKASSA_RECEIPT_VAT_CODE,
              payment_mode: "full_prepayment",
              payment_subject: "service"
            }
          ]
        }
      },
      idempotenceKey
    );

    const providerConfirmationUrl = payment.confirmation?.confirmation_url ?? null;
    if (!providerConfirmationUrl) {
      throw new AppError("YooKassa response does not include confirmation_url.", 502, "YOOKASSA_CONFIRMATION_URL_MISSING");
    }

    const updatedTopup = await prisma.organizationTopup.update({
      where: {
        id: topup.id
      },
      data: {
        providerPaymentId: payment.id,
        providerConfirmationUrl,
        providerStatus: payment.status,
        lastProviderSyncAt: new Date(),
        nextPollAt: new Date(),
        errorMessage: null
      },
      include: {
        user: true,
        organization: true
      }
    });

    return {
      topup: updatedTopup,
      reused: false
    };
  } catch (error) {
    await prisma.organizationTopup.update({
      where: { id: topup.id },
      data: {
        status: TOPUP_STATUS.FAILED,
        canceledAt: new Date(),
        cancelReasonCode: "payment_create_failed",
        cancelReasonText: "Failed to create payment in YooKassa",
        providerStatus: "payment_create_failed",
        errorMessage: truncateErrorMessage(error),
        nextPollAt: null
      }
    });

    logger.error(
      {
        err: error,
        topupId: topup.id,
        userId: userId.toString()
      },
      "Failed to create YooKassa payment"
    );

    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError("Не удалось создать ссылку на оплату. Попробуйте снова через минуту.", 502, PAYMENT_ERROR_CODES.TOPUP_CREATE_FAILED);
  }
}

export async function markTopupPollError(topupId: string, error: unknown) {
  const current = await prisma.organizationTopup.findUnique({
    where: { id: topupId },
    select: { pollAttempts: true }
  });

  if (!current) {
    return;
  }

  const nextAttempts = current.pollAttempts + 1;
  const delaySeconds = toBackoffDelaySeconds(nextAttempts);
  const nextPollAt = new Date(Date.now() + delaySeconds * 1000);

  await prisma.organizationTopup.update({
    where: { id: topupId },
    data: {
      pollAttempts: nextAttempts,
      nextPollAt,
      errorMessage: truncateErrorMessage(error)
    }
  });
}

export async function setTopupPendingPoll(input: {
  topupId: string;
  providerStatus?: string | null;
  providerPaymentId?: string | null;
  expiresAt?: Date | null;
}) {
  const nextPollAt = new Date(Date.now() + env.PAYMENT_POLL_INTERVAL_SECONDS * 1000);

  await prisma.organizationTopup.update({
    where: { id: input.topupId },
    data: {
      status: TOPUP_STATUS.AWAITING_PAYMENT,
      providerStatus: input.providerStatus ?? undefined,
      providerPaymentId: input.providerPaymentId ?? undefined,
      expiresAt: input.expiresAt ?? undefined,
      nextPollAt,
      lastProviderSyncAt: new Date(),
      errorMessage: null
    }
  });
}

export async function listTopupsForPolling(limit = env.PAYMENT_POLL_BATCH_SIZE) {
  return prisma.organizationTopup.findMany({
    where: {
      status: {
        in: ACTIVE_TOPUP_STATUSES
      },
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }, { expiresAt: { lte: new Date() } }]
    },
    orderBy: [{ nextPollAt: "asc" }, { createdAt: "asc" }],
    take: limit
  });
}

export async function upsertTopupPaymentAttempt(input: {
  topupId: string;
  payment: YookassaPayment;
  rawPayload?: unknown;
}) {
  const amountRubles = parseYookassaAmountToRubles(String(input.payment.amount?.value ?? "0.00"));
  const status = String(input.payment.status || "unknown");
  const paid = status === "succeeded" || input.payment.paid === true;
  const paidAt = parseDateOrNull(input.payment.paid_at) ?? parseDateOrNull(input.payment.captured_at);
  const canceledAt = status === "canceled" ? new Date() : null;

  return prisma.organizationTopupPaymentAttempt.upsert({
    where: {
      providerPaymentId: input.payment.id
    },
    create: {
      topupId: input.topupId,
      providerInvoiceId: null,
      providerPaymentId: input.payment.id,
      status,
      amountRubles,
      currency: String(input.payment.amount?.currency || env.YOOKASSA_CURRENCY),
      paid,
      cancellationParty: input.payment.cancellation_details?.party ?? null,
      cancellationReason: input.payment.cancellation_details?.reason ?? null,
      rawPayload: (input.rawPayload ?? input.payment) as Prisma.InputJsonValue,
      paidAt,
      canceledAt
    },
    update: {
      topupId: input.topupId,
      providerInvoiceId: null,
      status,
      amountRubles,
      currency: String(input.payment.amount?.currency || env.YOOKASSA_CURRENCY),
      paid,
      cancellationParty: input.payment.cancellation_details?.party ?? null,
      cancellationReason: input.payment.cancellation_details?.reason ?? null,
      rawPayload: (input.rawPayload ?? input.payment) as Prisma.InputJsonValue,
      paidAt,
      canceledAt
    }
  });
}

export async function findTopupByPayment(payment: YookassaPayment) {
  const metadataTopupId = String(payment.metadata?.internal_topup_id ?? payment.metadata?.topup_id ?? "").trim();
  if (metadataTopupId) {
    const byId = await prisma.organizationTopup.findUnique({
      where: { id: metadataTopupId },
      include: { user: true, organization: true }
    });
    if (byId) {
      return byId;
    }
  }

  const paymentId = String(payment.id || "").trim();
  if (paymentId) {
    return prisma.organizationTopup.findFirst({
      where: {
        providerPaymentId: paymentId
      },
      include: {
        user: true,
        organization: true
      },
      orderBy: { createdAt: "desc" }
    });
  }

  return null;
}

export async function finalizeTopupAsPaid(input: {
  topupId: string;
  providerPaymentId?: string | null;
  providerStatus?: string | null;
  paidAt?: Date | null;
}) {
  let result: FinalizeTopupResult | null = null;

  await prisma.$transaction(async (tx) => {
    const topupRows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        organization_id: bigint;
        user_id: bigint;
        amount_rubles: bigint;
      }>
    >`SELECT id, status, organization_id, user_id, amount_rubles FROM organization_topups WHERE id = ${input.topupId} FOR UPDATE`;

    const topup = topupRows[0];
    if (!topup) {
      throw new AppError("Topup not found.", 404, PAYMENT_ERROR_CODES.TOPUP_NOT_FOUND);
    }

    if (topup.status === TOPUP_STATUS.PAID) {
      result = {
        credited: false,
        topupId: topup.id,
        userId: topup.user_id
      };
      return;
    }

    const organizations = await tx.$queryRaw<Array<{ org_id: bigint; balance: bigint }>>`
      SELECT org_id, balance
      FROM organizations
      WHERE org_id = ${topup.organization_id}
      FOR UPDATE
    `;

    const organization = organizations[0];
    if (!organization) {
      throw new AppError("Organization not found.", 404, "ORG_NOT_FOUND");
    }

    const balanceBefore = BigInt(organization.balance);
    const amount = BigInt(topup.amount_rubles);
    const balanceAfter = balanceBefore + amount;

    await tx.organization.update({
      where: { id: topup.organization_id },
      data: {
        balance: balanceAfter
      }
    });

    await tx.organizationBalanceTransaction.create({
      data: {
        organizationId: topup.organization_id,
        direction: "credit",
        amountRubles: amount,
        balanceBeforeRubles: balanceBefore,
        balanceAfterRubles: balanceAfter,
        sourceType: "topup",
        sourceId: topup.id,
        createdByUserId: topup.user_id,
        comment: "YooKassa topup"
      }
    });

    await tx.organizationTopup.update({
      where: {
        id: topup.id
      },
      data: {
        status: TOPUP_STATUS.PAID,
        paidAt: input.paidAt ?? new Date(),
        providerPaymentId: input.providerPaymentId ?? undefined,
        providerStatus: input.providerStatus ?? "succeeded",
        canceledAt: null,
        cancelReasonCode: null,
        cancelReasonText: null,
        errorMessage: null,
        pollAttempts: 0,
        nextPollAt: null,
        lastProviderSyncAt: new Date()
      }
    });

    result = {
      credited: true,
      topupId: topup.id,
      userId: topup.user_id
    };
  });

  return result!;
}

export async function closeTopupTerminal(input: {
  topupId: string;
  terminalStatus: "expired" | "canceled";
  providerStatus?: string | null;
  providerPaymentId?: string | null;
  reasonCode?: string | null;
  reasonText?: string | null;
}) {
  let changed = false;
  let userId: bigint | null = null;

  await prisma.$transaction(async (tx) => {
    const topupRows = await tx.$queryRaw<
      Array<{
        id: string;
        status: string;
        user_id: bigint;
      }>
    >`SELECT id, status, user_id FROM organization_topups WHERE id = ${input.topupId} FOR UPDATE`;

    const topup = topupRows[0];
    if (!topup) {
      throw new AppError("Topup not found.", 404, PAYMENT_ERROR_CODES.TOPUP_NOT_FOUND);
    }

    userId = topup.user_id;

    if (topup.status === TOPUP_STATUS.PAID) {
      changed = false;
      return;
    }

    if (topup.status === input.terminalStatus) {
      changed = false;
      return;
    }

    await tx.organizationTopup.update({
      where: { id: topup.id },
      data: {
        status: input.terminalStatus,
        providerStatus: input.providerStatus ?? undefined,
        providerPaymentId: input.providerPaymentId ?? undefined,
        canceledAt: new Date(),
        cancelReasonCode: input.reasonCode ?? undefined,
        cancelReasonText: input.reasonText ?? undefined,
        nextPollAt: null,
        lastProviderSyncAt: new Date()
      }
    });

    changed = true;
  });

  return {
    changed,
    userId
  };
}

export async function processPaymentSucceeded(input: {
  payment: YookassaPayment;
  rawPayload?: unknown;
  source: "webhook" | "worker";
}) {
  const topup = await findTopupByPayment(input.payment);
  if (!topup) {
    logger.warn({ paymentId: input.payment.id, source: input.source }, "Topup not found for succeeded payment");
    return {
      handled: false,
      topup: null
    };
  }

  await upsertTopupPaymentAttempt({
    topupId: topup.id,
    payment: input.payment,
    rawPayload: input.rawPayload
  });

  const finalize = await finalizeTopupAsPaid({
    topupId: topup.id,
    providerPaymentId: input.payment.id,
    providerStatus: input.payment.status,
    paidAt: parseDateOrNull(input.payment.paid_at) ?? parseDateOrNull(input.payment.captured_at)
  });

  if (finalize.credited) {
    await sendTopupFinalizedMessages({
      userId: finalize.userId,
      outcome: "paid"
    });
  }

  return {
    handled: true,
    topup
  };
}

export async function processPaymentCanceled(input: {
  payment: YookassaPayment;
  rawPayload?: unknown;
  source: "webhook" | "worker";
}) {
  const topup = await findTopupByPayment(input.payment);
  if (!topup) {
    logger.warn({ paymentId: input.payment.id, source: input.source }, "Topup not found for canceled payment");
    return {
      handled: false,
      topup: null
    };
  }

  await upsertTopupPaymentAttempt({
    topupId: topup.id,
    payment: input.payment,
    rawPayload: input.rawPayload
  });

  if (topup.status === TOPUP_STATUS.PAID) {
    return {
      handled: true,
      topup
    };
  }

  const now = new Date();
  const cancelPolicy = normalizeCancelOutcome({
    providerReason: input.payment.cancellation_details?.reason,
    topupExpiresAt: topup.expiresAt,
    now
  });

  const closeResult = await closeTopupTerminal({
    topupId: topup.id,
    terminalStatus: cancelPolicy.terminalStatus,
    providerStatus: input.payment.status,
    providerPaymentId: input.payment.id,
    reasonCode: cancelPolicy.reasonCode,
    reasonText: cancelPolicy.reasonText
  });

  if (closeResult.changed && closeResult.userId) {
    await sendTopupFinalizedMessages({
      userId: closeResult.userId,
      outcome: cancelPolicy.terminalStatus === TOPUP_STATUS.EXPIRED ? "expired" : "canceled"
    });
  }

  return {
    handled: true,
    topup
  };
}

export async function reconcileTopupWithProvider(topupId: string) {
  const topup = await prisma.organizationTopup.findUnique({
    where: { id: topupId }
  });

  if (!topup) {
    return;
  }

  if (
    topup.status === TOPUP_STATUS.PAID ||
    topup.status === TOPUP_STATUS.CANCELED ||
    topup.status === TOPUP_STATUS.EXPIRED ||
    topup.status === TOPUP_STATUS.FAILED
  ) {
    return;
  }

  const providerPaymentId = String(topup.providerPaymentId || "").trim();
  if (!providerPaymentId) {
    await markTopupPollError(topup.id, "Missing provider payment id.");
    return;
  }

  try {
    const payment = await yookassaClient.getPayment(providerPaymentId);

    await prisma.organizationTopup.update({
      where: { id: topup.id },
      data: {
        providerStatus: payment.status,
        lastProviderSyncAt: new Date(),
        nextPollAt: new Date(Date.now() + env.PAYMENT_POLL_INTERVAL_SECONDS * 1000)
      }
    });

    if (payment.status === "succeeded") {
      await processPaymentSucceeded({
        payment,
        source: "worker"
      });
      return;
    }

    if (payment.status === "canceled") {
      await processPaymentCanceled({
        payment,
        source: "worker"
      });
      return;
    }

    const isExpiredByLocalTtl = topup.expiresAt.getTime() <= Date.now();
    if (!isExpiredByLocalTtl) {
      await setTopupPendingPoll({
        topupId: topup.id,
        providerStatus: payment.status,
        providerPaymentId: payment.id,
        expiresAt: topup.expiresAt
      });
      return;
    }

    const secondCheck = await yookassaClient.getPayment(providerPaymentId);
    if (secondCheck.status === "succeeded") {
      await processPaymentSucceeded({
        payment: secondCheck,
        source: "worker"
      });
      return;
    }

    if (secondCheck.status === "canceled") {
      await processPaymentCanceled({
        payment: secondCheck,
        source: "worker"
      });
      return;
    }

    const closeResult = await closeTopupTerminal({
      topupId: topup.id,
      terminalStatus: TOPUP_STATUS.EXPIRED,
      providerStatus: secondCheck.status,
      providerPaymentId: providerPaymentId,
      reasonCode: "expired_local_timeout",
      reasonText: "Pending after local TTL exceeded"
    });

    if (closeResult.changed && closeResult.userId) {
      await sendTopupFinalizedMessages({
        userId: closeResult.userId,
        outcome: "expired"
      });
    }
  } catch (error) {
    await markTopupPollError(topup.id, error);

    if (error instanceof YookassaHttpError && !error.retryable) {
      logger.error(
        {
          topupId: topup.id,
          status: error.status,
          response: error.responseBody
        },
        "Non-retryable YooKassa error while polling topup"
      );
    }
  }
}

export async function handleCreateTopupByPackages(input: { userIdRaw: string | bigint; packagesCount: number }) {
  const result = await createOrReuseTopupForUser(input);
  return {
    ...result,
    linkMessage: result.reused ? getActiveTopupUserMessage(result.topup) : getTopupPaymentLinkMessage(result.topup)
  };
}

export async function handleExistingOrThrowActiveTopup(userIdRaw: string | bigint) {
  const existing = await getActiveTopupForUser(userIdRaw);
  if (!existing) {
    return null;
  }

  return {
    topup: existing,
    text: getActiveTopupUserMessage(existing)
  };
}

export async function markTopupWebhookProcessing(input: {
  webhookLogId: bigint;
  processingStatus: string;
  processingError?: string | null;
  topupId?: string | null;
}) {
  await prisma.yookassaWebhookLog.update({
    where: {
      id: input.webhookLogId
    },
    data: {
      processingStatus: input.processingStatus,
      processingError: input.processingError ?? null,
      topupId: input.topupId ?? undefined,
      processedAt: new Date()
    }
  });
}

export async function createWebhookLog(input: {
  eventType: string;
  providerObjectId: string;
  remoteIp: string | null;
  isTrustedIp: boolean;
  headers: Record<string, unknown>;
  payload: unknown;
  payloadSha256: string;
}) {
  return prisma.yookassaWebhookLog.upsert({
    where: {
      payloadSha256: input.payloadSha256
    },
    create: {
      eventType: input.eventType,
      providerObjectId: input.providerObjectId,
      remoteIp: input.remoteIp,
      isTrustedIp: input.isTrustedIp,
      headers: input.headers as Prisma.InputJsonValue,
      payload: input.payload as Prisma.InputJsonValue,
      payloadSha256: input.payloadSha256,
      processingStatus: "received"
    },
    update: {
      eventType: input.eventType,
      providerObjectId: input.providerObjectId,
      remoteIp: input.remoteIp,
      isTrustedIp: input.isTrustedIp,
      headers: input.headers as Prisma.InputJsonValue,
      payload: input.payload as Prisma.InputJsonValue,
      processingStatus: "received",
      processingError: null,
      processedAt: null
    }
  });
}

export async function fetchPaymentForWebhookObject(input: {
  eventType: string;
  providerObjectId: string;
  payloadObject: Record<string, unknown> | null;
}) {
  const paymentId = String(input.payloadObject?.id ?? input.providerObjectId ?? "").trim();
  if (!paymentId) {
    throw new AppError("Webhook payload does not include payment id.", 400, "WEBHOOK_PAYMENT_ID_MISSING");
  }

  return yookassaClient.getPayment(paymentId);
}


