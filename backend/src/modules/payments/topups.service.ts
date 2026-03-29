import { Prisma } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { logger } from "../../common/logger";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { maxBotClient } from "../bot/max-bot.client";
import { getUserProfilePayload } from "../bot/profile.service";
import { ACTIVE_TOPUP_STATUSES, PAYMENT_ERROR_CODES, TOPUP_STATUS } from "./payments.constants";
import { formatKopecksAsRubles, kopecksToYookassaAmount, legacyRublesToKopecks, parseYookassaAmountToKopecks } from "./money";
import { YookassaHttpError, type YookassaPayment, yookassaClient } from "./yookassa.client";

const USER_TOPUP_LINK_TTL_MINUTES = Math.ceil(env.PAYMENT_INVOICE_TTL_SECONDS / 60);

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

function resolveTariffPerPackageKopecks(input: {
  organizationTariffPerPackageKopecks: bigint;
  organizationUserTarif: number | null;
  userTarif: number | null;
}) {
  if (input.organizationTariffPerPackageKopecks > 0n) {
    return input.organizationTariffPerPackageKopecks;
  }

  if (input.userTarif != null && Number.isFinite(input.userTarif) && input.userTarif > 0) {
    return legacyRublesToKopecks(input.userTarif);
  }

  if (input.organizationUserTarif != null && Number.isFinite(input.organizationUserTarif) && input.organizationUserTarif > 0) {
    return legacyRublesToKopecks(input.organizationUserTarif);
  }

  return 0n;
}

function extractInvoiceUrl(topup: { providerInvoiceUrl: string | null; id: string }) {
  if (topup.providerInvoiceUrl) {
    return topup.providerInvoiceUrl;
  }
  return `${env.YOOKASSA_API_BASE_URL.replace(/\/$/, "")}/v3/invoices/${encodeURIComponent(topup.id)}`;
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
    throw new AppError(
      "Введите целое положительное число пакетов.",
      400,
      PAYMENT_ERROR_CODES.TOPUP_INVALID_PACKAGES_COUNT
    );
  }

  if (packagesCount < env.PAYMENT_MIN_PACKAGES_PER_TOPUP || packagesCount > env.PAYMENT_MAX_PACKAGES_PER_TOPUP) {
    throw new AppError(
      `Количество пакетов должно быть от ${env.PAYMENT_MIN_PACKAGES_PER_TOPUP} до ${env.PAYMENT_MAX_PACKAGES_PER_TOPUP}.`,
      400,
      PAYMENT_ERROR_CODES.TOPUP_INVALID_PACKAGES_COUNT
    );
  }
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
  amountKopecks: bigint;
  providerInvoiceUrl: string | null;
}) {
  const url = topup.providerInvoiceUrl || "(ссылка недоступна)";
  return `Для оплаты перейдите по ссылке: ${url}\nВремя для оплаты: ${USER_TOPUP_LINK_TTL_MINUTES} минуты, после этого ссылка станет недействительной.`;
}

export function getActiveTopupUserMessage(topup: {
  amountKopecks: bigint;
  providerInvoiceUrl: string | null;
  expiresAt: Date;
}) {
  const amountRub = formatKopecksAsRubles(topup.amountKopecks);
  const url = topup.providerInvoiceUrl || "(ссылка недоступна)";
  const expiresAt = formatMoscowDateTime(topup.expiresAt);

  return `У тебя есть незавершенное пополнение баланса на ${amountRub}.\nОплати его по ссылке: ${url}\nСрок действия до ${expiresAt}.`;
}

async function sendTopupFinalizedMessages(input: { userId: bigint; success: boolean }) {
  if (input.success) {
    await maxBotClient.sendMessage({
      userId: input.userId.toString(),
      text: "Платеж прошел, средства зачислены на ваш счет."
    });
  } else {
    await maxBotClient.sendMessage({
      userId: input.userId.toString(),
      text: "Время оплаты истекло, платеж отменен."
    });
  }

  const profile = await getUserProfilePayload(input.userId);
  if (!profile) {
    return;
  }

  await maxBotClient.sendMessage({
    userId: input.userId.toString(),
    text: profile.text,
    attachments: profile.attachments
  });
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
    amountKopecks: activeTopup.amountKopecks.toString(),
    providerInvoiceUrl: activeTopup.providerInvoiceUrl,
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

  const tariffPerPackageKopecks = resolveTariffPerPackageKopecks({
    organizationTariffPerPackageKopecks: user.organization.tariffPerPackageKopecks,
    organizationUserTarif: user.organization.userTarif,
    userTarif: user.userTarif
  });

  if (tariffPerPackageKopecks <= 0n) {
    throw new AppError("Тариф организации не настроен.", 409, "ORG_TARIFF_NOT_CONFIGURED");
  }

  const amountKopecks = BigInt(input.packagesCount) * tariffPerPackageKopecks;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.PAYMENT_INVOICE_TTL_SECONDS * 1000);
  const idempotenceKey = yookassaClient.generateIdempotenceKey();

  let topup = null as TopupWithRelations | null;

  try {
    topup = await prisma.organizationTopup.create({
      data: {
        organizationId: user.organizationId,
        userId,
        status: TOPUP_STATUS.AWAITING_PAYMENT,
        packagesCount: input.packagesCount,
        tariffPerPackageKopecks,
        amountKopecks,
        currency: "RUB",
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
    const itemDescription = `Пополнение баланса организации: ${input.packagesCount} пакетов`;

    const invoice = await yookassaClient.createInvoice(
      {
        payment_data: {
          amount: {
            value: kopecksToYookassaAmount(amountKopecks),
            currency: "RUB"
          },
          capture: true,
          description: itemDescription,
          metadata: {
            topup_id: topup.id,
            organization_id: user.organizationId.toString(),
            user_id: user.id.toString(),
            packages_count: String(input.packagesCount),
            tariff_per_package_kopecks: tariffPerPackageKopecks.toString()
          }
        },
        cart: [
          {
            description: itemDescription,
            price: {
              value: kopecksToYookassaAmount(tariffPerPackageKopecks),
              currency: "RUB"
            },
            quantity: input.packagesCount
          }
        ],
        delivery_method_data: {
          type: "self"
        },
        locale: "ru_RU",
        expires_at: expiresAt.toISOString()
      },
      idempotenceKey
    );

    const providerUrl = invoice.delivery_method?.url ?? null;
    const invoiceExpiresAt = parseDateOrNull(invoice.expires_at) ?? expiresAt;

    const updatedTopup = await prisma.organizationTopup.update({
      where: {
        id: topup.id
      },
      data: {
        providerInvoiceId: invoice.id,
        providerInvoiceUrl: providerUrl,
        providerStatus: invoice.status,
        expiresAt: invoiceExpiresAt,
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
        cancelReasonCode: "invoice_create_failed",
        cancelReasonText: "Failed to create invoice in YooKassa",
        providerStatus: "invoice_create_failed",
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
      "Failed to create YooKassa invoice"
    );

    throw new AppError(
      "Не удалось создать ссылку на оплату. Попробуйте снова через минуту.",
      502,
      PAYMENT_ERROR_CODES.TOPUP_CREATE_FAILED
    );
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
      OR: [{ nextPollAt: null }, { nextPollAt: { lte: new Date() } }]
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
  const amountKopecks = parseYookassaAmountToKopecks(String(input.payment.amount?.value ?? "0.00"));
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
      providerInvoiceId: input.payment.invoice_details?.id ?? null,
      providerPaymentId: input.payment.id,
      status,
      amountKopecks,
      currency: String(input.payment.amount?.currency || "RUB"),
      paid,
      cancellationParty: input.payment.cancellation_details?.party ?? null,
      cancellationReason: input.payment.cancellation_details?.reason ?? null,
      rawPayload: (input.rawPayload ?? input.payment) as Prisma.InputJsonValue,
      paidAt,
      canceledAt
    },
    update: {
      topupId: input.topupId,
      providerInvoiceId: input.payment.invoice_details?.id ?? null,
      status,
      amountKopecks,
      currency: String(input.payment.amount?.currency || "RUB"),
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
  const metadataTopupId = String(payment.metadata?.topup_id ?? "").trim();
  if (metadataTopupId) {
    const byId = await prisma.organizationTopup.findUnique({
      where: { id: metadataTopupId },
      include: { user: true, organization: true }
    });
    if (byId) {
      return byId;
    }
  }

  const invoiceId = String(payment.invoice_details?.id ?? "").trim();
  if (invoiceId) {
    return prisma.organizationTopup.findFirst({
      where: {
        providerInvoiceId: invoiceId
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
        amount_kopecks: bigint;
      }>
    >`SELECT id, status, organization_id, user_id, amount_kopecks FROM organization_topups WHERE id = ${input.topupId} FOR UPDATE`;

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

    const organizations = await tx.$queryRaw<Array<{ org_id: bigint; balance_kopecks: bigint }>>`
      SELECT org_id, balance_kopecks
      FROM organizations
      WHERE org_id = ${topup.organization_id}
      FOR UPDATE
    `;

    const organization = organizations[0];
    if (!organization) {
      throw new AppError("Organization not found.", 404, "ORG_NOT_FOUND");
    }

    const balanceBefore = BigInt(organization.balance_kopecks);
    const amount = BigInt(topup.amount_kopecks);
    const balanceAfter = balanceBefore + amount;

    await tx.organization.update({
      where: { id: topup.organization_id },
      data: {
        balanceKopecks: balanceAfter
      }
    });

    await tx.organizationBalanceTransaction.create({
      data: {
        organizationId: topup.organization_id,
        direction: "credit",
        amountKopecks: amount,
        balanceBeforeKopecks: balanceBefore,
        balanceAfterKopecks: balanceAfter,
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
      success: true
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

  const invoiceId = String(input.payment.invoice_details?.id || topup.providerInvoiceId || "").trim();
  if (!invoiceId) {
    const closeResult = await closeTopupTerminal({
      topupId: topup.id,
      terminalStatus: TOPUP_STATUS.CANCELED,
      providerStatus: input.payment.status,
      providerPaymentId: input.payment.id,
      reasonCode: input.payment.cancellation_details?.reason,
      reasonText: input.payment.cancellation_details?.party
    });

    if (closeResult.changed && closeResult.userId) {
      await sendTopupFinalizedMessages({
        userId: closeResult.userId,
        success: false
      });
    }

    return {
      handled: true,
      topup
    };
  }

  try {
    const invoice = await yookassaClient.getInvoice(invoiceId);
    const invoiceExpiresAt = parseDateOrNull(invoice.expires_at) ?? topup.expiresAt;
    const invoicePaymentId = invoice.payment_details?.id ?? input.payment.id;

    if (invoicePaymentId && invoicePaymentId !== input.payment.id) {
      const payment = await yookassaClient.getPayment(invoicePaymentId);
      if (payment.status === "succeeded") {
        return processPaymentSucceeded({
          payment,
          rawPayload: input.rawPayload,
          source: input.source
        });
      }
    }

    if (invoice.status === "pending" && invoiceExpiresAt.getTime() > Date.now()) {
      await setTopupPendingPoll({
        topupId: topup.id,
        providerStatus: invoice.status,
        providerPaymentId: invoicePaymentId,
        expiresAt: invoiceExpiresAt
      });

      return {
        handled: true,
        topup
      };
    }

    const isExpired = invoiceExpiresAt.getTime() <= Date.now();
    const closeResult = await closeTopupTerminal({
      topupId: topup.id,
      terminalStatus: isExpired ? TOPUP_STATUS.EXPIRED : TOPUP_STATUS.CANCELED,
      providerStatus: invoice.status,
      providerPaymentId: invoicePaymentId,
      reasonCode: input.payment.cancellation_details?.reason,
      reasonText: input.payment.cancellation_details?.party
    });

    if (closeResult.changed && closeResult.userId) {
      await sendTopupFinalizedMessages({
        userId: closeResult.userId,
        success: false
      });
    }

    return {
      handled: true,
      topup
    };
  } catch (error) {
    if (error instanceof YookassaHttpError && error.retryable) {
      throw new AppError("Failed to verify invoice state in YooKassa.", 502, "YOOKASSA_TEMPORARY_ERROR");
    }
    throw error;
  }
}

export async function reconcileTopupWithProvider(topupId: string) {
  const topup = await prisma.organizationTopup.findUnique({
    where: { id: topupId }
  });

  if (!topup) {
    return;
  }

  if (topup.status === TOPUP_STATUS.PAID || topup.status === TOPUP_STATUS.CANCELED || topup.status === TOPUP_STATUS.EXPIRED) {
    return;
  }

  const invoiceId = String(topup.providerInvoiceId || "").trim();
  const providerPaymentId = String(topup.providerPaymentId || "").trim();

  if (!invoiceId && !providerPaymentId) {
    await markTopupPollError(topup.id, "Missing provider identifiers.");
    return;
  }

  try {
    let invoicePaymentId = providerPaymentId || "";
    let invoiceStatus = topup.providerStatus ?? "pending";
    let invoiceExpiresAt = topup.expiresAt;

    if (invoiceId) {
      const invoice = await yookassaClient.getInvoice(invoiceId);
      invoiceStatus = invoice.status;
      invoiceExpiresAt = parseDateOrNull(invoice.expires_at) ?? topup.expiresAt;
      invoicePaymentId = String(invoice.payment_details?.id || providerPaymentId || "").trim();

      await prisma.organizationTopup.update({
        where: { id: topup.id },
        data: {
          providerStatus: invoice.status,
          expiresAt: invoiceExpiresAt,
          providerPaymentId: invoicePaymentId || undefined,
          lastProviderSyncAt: new Date()
        }
      });
    }

    if (invoicePaymentId) {
      const payment = await yookassaClient.getPayment(invoicePaymentId);

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

      await setTopupPendingPoll({
        topupId: topup.id,
        providerStatus: payment.status,
        providerPaymentId: payment.id,
        expiresAt: invoiceExpiresAt
      });
      return;
    }

    if (invoiceExpiresAt.getTime() <= Date.now() || invoiceStatus === "canceled") {
      const closeResult = await closeTopupTerminal({
        topupId: topup.id,
        terminalStatus: invoiceExpiresAt.getTime() <= Date.now() ? TOPUP_STATUS.EXPIRED : TOPUP_STATUS.CANCELED,
        providerStatus: invoiceStatus,
        reasonCode: "invoice_terminal",
        reasonText: invoiceStatus
      });

      if (closeResult.changed && closeResult.userId) {
        await sendTopupFinalizedMessages({
          userId: closeResult.userId,
          success: false
        });
      }

      return;
    }

    await setTopupPendingPoll({
      topupId: topup.id,
      providerStatus: invoiceStatus,
      providerPaymentId: invoicePaymentId,
      expiresAt: invoiceExpiresAt
    });
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
  return prisma.yookassaWebhookLog.create({
    data: {
      eventType: input.eventType,
      providerObjectId: input.providerObjectId,
      remoteIp: input.remoteIp,
      isTrustedIp: input.isTrustedIp,
      headers: input.headers as Prisma.InputJsonValue,
      payload: input.payload as Prisma.InputJsonValue,
      payloadSha256: input.payloadSha256,
      processingStatus: "received"
    }
  });
}

export function isDuplicateWebhookPayloadError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  return error.code === "P2002" && error.message.toLowerCase().includes("yookassa_webhook_log_payload_sha256_key");
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
