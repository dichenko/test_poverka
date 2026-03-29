import { SubmissionStatus, type UserRole, type WaterType } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { prisma } from "../../common/prisma";
import { legacyRublesToKopecks } from "../payments/money";

const INSUFFICIENT_BALANCE_MESSAGE =
  "Недостаточно средств на балансе организации. Отправка не выполнена. Пополните баланс и попробуйте снова.";

function parseMeterValue(rawValue: string) {
  const normalized = rawValue.replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new AppError("Invalid meter value.", 400, "INVALID_METER_VALUE");
  }
  return normalized;
}

function resolveTariffKopecks(input: {
  tariffPerPackageKopecks: bigint;
  userTarifLegacy: number | null;
}): bigint {
  if (input.tariffPerPackageKopecks > 0n) {
    return input.tariffPerPackageKopecks;
  }

  if (input.userTarifLegacy != null && Number.isFinite(input.userTarifLegacy) && input.userTarifLegacy > 0) {
    return legacyRublesToKopecks(input.userTarifLegacy);
  }

  return 0n;
}

function resolveBalanceKopecks(input: {
  balanceKopecks: bigint;
  balanceLegacy: number | null;
}) {
  if (input.balanceKopecks > 0n) {
    return input.balanceKopecks;
  }
  return legacyRublesToKopecks(input.balanceLegacy);
}

function ensureOrganizationCanSubmit(input: {
  balanceKopecks: bigint;
  tariffPerPackageKopecks: bigint;
  tariffLegacy: number | null;
  balanceLegacy: number | null;
}) {
  const tariffKopecks = resolveTariffKopecks({
    tariffPerPackageKopecks: input.tariffPerPackageKopecks,
    userTarifLegacy: input.tariffLegacy
  });

  if (tariffKopecks <= 0n) {
    throw new AppError("Тариф организации не настроен.", 409, "ORG_TARIF_NOT_CONFIGURED");
  }

  const balanceKopecks = resolveBalanceKopecks({
    balanceKopecks: input.balanceKopecks,
    balanceLegacy: input.balanceLegacy
  });

  if (balanceKopecks < tariffKopecks) {
    throw new AppError(INSUFFICIENT_BALANCE_MESSAGE, 409, "INSUFFICIENT_BALANCE");
  }

  return {
    balanceKopecks,
    tariffKopecks
  };
}

export function parseUserId(raw: string) {
  try {
    return BigInt(raw);
  } catch {
    throw new AppError("Invalid user id.", 400, "USER_ID_INVALID");
  }
}

export async function createDraftSubmission(input: {
  userId: string;
  address: string;
  phone: string;
  waterType: WaterType;
  equipmentTypeId: number;
  factoryNumber: string;
  productionYear: number;
  reading: string;
}) {
  const user = await prisma.user.findUnique({
    where: { id: parseUserId(input.userId) },
    include: { organization: true }
  });

  if (!user) {
    throw new AppError("User is missing.", 403, "USER_NOT_FOUND");
  }
  if (!user.organizationId || !user.organization) {
    throw new AppError("Organization is required for submission.", 403, "ORG_REQUIRED");
  }

  const equipmentType = await prisma.equipmentType.findUnique({
    where: { id: input.equipmentTypeId }
  });
  if (!equipmentType) {
    throw new AppError("Equipment type not found.", 400, "EQUIPMENT_TYPE_NOT_FOUND");
  }

  ensureOrganizationCanSubmit({
    balanceKopecks: user.organization.balanceKopecks,
    tariffPerPackageKopecks: user.organization.tariffPerPackageKopecks,
    tariffLegacy: user.organization.userTarif,
    balanceLegacy: user.organization.balance
  });

  const currentValue = parseMeterValue(input.reading);

  const existingPending = await prisma.meterSubmission.findFirst({
    where: {
      userId: user.id,
      status: SubmissionStatus.PENDING_CONFIRMATION
    },
    orderBy: { createdAt: "desc" }
  });

  if (existingPending) {
    const updated = await prisma.meterSubmission.update({
      where: { id: existingPending.id },
      data: {
        meterNumber: input.factoryNumber,
        currentValue,
        address: input.address,
        phone: input.phone,
        waterType: input.waterType,
        equipmentTypeId: input.equipmentTypeId,
        productionYear: input.productionYear,
        awaitingPhoto: false,
        confirmedAt: null
      },
      include: { equipmentType: true }
    });

    await prisma.submissionStatusHistory.create({
      data: {
        submissionId: updated.id,
        oldStatus: SubmissionStatus.PENDING_CONFIRMATION,
        newStatus: SubmissionStatus.PENDING_CONFIRMATION,
        changedByUserId: user.id,
        reason: "Draft edited from miniapp."
      }
    });

    return updated;
  }

  const submission = await prisma.meterSubmission.create({
    data: {
      userId: user.id,
      organizationId: user.organizationId,
      meterNumber: input.factoryNumber,
      currentValue,
      address: input.address,
      phone: input.phone,
      waterType: input.waterType,
      equipmentTypeId: input.equipmentTypeId,
      productionYear: input.productionYear,
      status: SubmissionStatus.PENDING_CONFIRMATION,
      awaitingPhoto: false
    },
    include: { equipmentType: true }
  });

  await prisma.submissionStatusHistory.create({
    data: {
      submissionId: submission.id,
      oldStatus: SubmissionStatus.DRAFT,
      newStatus: SubmissionStatus.PENDING_CONFIRMATION,
      changedByUserId: user.id,
      reason: "Draft submitted from miniapp."
    }
  });

  return submission;
}

export async function confirmSubmission(input: {
  submissionId: string;
  actorUserId: string;
  actorRole: UserRole;
}) {
  const current = await prisma.meterSubmission.findUnique({
    where: { id: input.submissionId }
  });
  if (!current) {
    throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
  }

  const actorUserId = parseUserId(input.actorUserId);

  if (
    input.actorRole !== "ADMIN" &&
    (current.userId !== actorUserId || current.status !== SubmissionStatus.PENDING_CONFIRMATION)
  ) {
    throw new AppError("Submission cannot be confirmed.", 403, "SUBMISSION_FORBIDDEN");
  }

  if (current.status === SubmissionStatus.CONFIRMED) {
    return current;
  }

  if (current.status !== SubmissionStatus.PENDING_CONFIRMATION && input.actorRole !== "ADMIN") {
    throw new AppError("Submission is not pending confirmation.", 409, "SUBMISSION_INVALID_STATUS");
  }

  return prisma.$transaction(async (tx) => {
    const submission = await tx.meterSubmission.findUnique({ where: { id: input.submissionId } });
    if (!submission) {
      throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
    }

    if (submission.status === SubmissionStatus.CONFIRMED) {
      return submission;
    }

    if (submission.status !== SubmissionStatus.PENDING_CONFIRMATION) {
      throw new AppError("Submission is not pending confirmation.", 409, "SUBMISSION_INVALID_STATUS");
    }

    const confirmedAt = new Date();
    const updateResult = await tx.meterSubmission.updateMany({
      where: {
        id: submission.id,
        status: SubmissionStatus.PENDING_CONFIRMATION
      },
      data: {
        status: SubmissionStatus.CONFIRMED,
        confirmedAt,
        awaitingPhoto: false
      }
    });

    if (updateResult.count === 0) {
      const latest = await tx.meterSubmission.findUnique({ where: { id: submission.id } });
      if (!latest) {
        throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
      }
      return latest;
    }

    const orgRows = await tx.$queryRaw<
      Array<{
        org_id: bigint;
        balance_kopecks: bigint;
        tariff_per_package_kopecks: bigint;
        balance: number | null;
        user_tarif: number | null;
      }>
    >`
      SELECT org_id, balance_kopecks, tariff_per_package_kopecks, balance, user_tarif
      FROM organizations
      WHERE org_id = ${submission.organizationId}
      FOR UPDATE
    `;

    const organization = orgRows[0];
    if (!organization) {
      throw new AppError("Organization not found.", 404, "ORG_NOT_FOUND");
    }

    const { balanceKopecks, tariffKopecks } = ensureOrganizationCanSubmit({
      balanceKopecks: BigInt(organization.balance_kopecks),
      tariffPerPackageKopecks: BigInt(organization.tariff_per_package_kopecks),
      tariffLegacy: organization.user_tarif,
      balanceLegacy: organization.balance
    });

    const balanceAfterKopecks = balanceKopecks - tariffKopecks;

    await tx.organization.update({
      where: { id: submission.organizationId },
      data: {
        balanceKopecks: balanceAfterKopecks
      }
    });

    await tx.organizationBalanceTransaction.create({
      data: {
        organizationId: submission.organizationId,
        direction: "debit",
        amountKopecks: tariffKopecks,
        balanceBeforeKopecks: balanceKopecks,
        balanceAfterKopecks,
        sourceType: "action_spend",
        sourceId: submission.id,
        createdByUserId: actorUserId,
        comment: "Submission confirmation charge"
      }
    });

    await tx.submissionStatusHistory.create({
      data: {
        submissionId: submission.id,
        oldStatus: SubmissionStatus.PENDING_CONFIRMATION,
        newStatus: SubmissionStatus.CONFIRMED,
        changedByUserId: actorUserId,
        reason: "Confirmed by user."
      }
    });

    await tx.submissionBillingEvent.create({
      data: {
        userId: submission.userId,
        organizationId: submission.organizationId,
        submissionId: submission.id,
        amountKopecks: tariffKopecks
      }
    });

    return tx.meterSubmission.findUniqueOrThrow({
      where: { id: submission.id }
    });
  });
}

export async function rejectSubmissionForInsufficientBalance(input: { submissionId: string; userId: string }) {
  const userId = parseUserId(input.userId);
  const submission = await prisma.meterSubmission.findUnique({
    where: { id: input.submissionId }
  });
  if (!submission || submission.userId !== userId) {
    throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== SubmissionStatus.PENDING_CONFIRMATION) {
    return submission;
  }

  return prisma.$transaction(async (tx) => {
    const updated = await tx.meterSubmission.updateMany({
      where: {
        id: submission.id,
        userId,
        status: SubmissionStatus.PENDING_CONFIRMATION
      },
      data: {
        status: SubmissionStatus.REJECTED,
        rejectedAt: new Date(),
        awaitingPhoto: false
      }
    });

    if (updated.count > 0) {
      await tx.submissionStatusHistory.create({
        data: {
          submissionId: submission.id,
          oldStatus: SubmissionStatus.PENDING_CONFIRMATION,
          newStatus: SubmissionStatus.REJECTED,
          changedByUserId: userId,
          reason: "Rejected: insufficient organization balance."
        }
      });
    }

    return tx.meterSubmission.findUniqueOrThrow({
      where: { id: submission.id }
    });
  });
}

export async function markSubmissionAwaitingPhoto(input: { submissionId: string; userId: string }) {
  const userId = parseUserId(input.userId);
  const submission = await prisma.meterSubmission.findUnique({
    where: { id: input.submissionId }
  });
  if (!submission || submission.userId !== userId) {
    throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== SubmissionStatus.PENDING_CONFIRMATION) {
    throw new AppError("Submission is not pending confirmation.", 409, "SUBMISSION_INVALID_STATUS");
  }

  return prisma.meterSubmission.update({
    where: { id: submission.id },
    data: { awaitingPhoto: true },
    include: { equipmentType: true }
  });
}

export async function getAwaitingPhotoSubmission(userIdRaw: string) {
  const userId = parseUserId(userIdRaw);
  return prisma.meterSubmission.findFirst({
    where: {
      userId,
      status: SubmissionStatus.PENDING_CONFIRMATION,
      awaitingPhoto: true
    },
    include: {
      equipmentType: true
    },
    orderBy: { createdAt: "desc" }
  });
}

export async function cancelPendingSubmission(input: { submissionId: string; userId: string }) {
  const userId = parseUserId(input.userId);
  const submission = await prisma.meterSubmission.findUnique({
    where: { id: input.submissionId },
    include: { files: true, user: true, organization: true }
  });

  if (!submission || submission.userId !== userId) {
    throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
  }
  if (submission.status !== SubmissionStatus.PENDING_CONFIRMATION) {
    throw new AppError("Submission is not pending confirmation.", 409, "SUBMISSION_INVALID_STATUS");
  }

  const storageKeys = submission.files.map((item) => item.storageKey);

  await prisma.$transaction([
    prisma.submissionStatusHistory.deleteMany({ where: { submissionId: submission.id } }),
    prisma.fileEntity.deleteMany({ where: { submissionId: submission.id } }),
    prisma.meterSubmission.delete({ where: { id: submission.id } })
  ]);

  return {
    submission,
    storageKeys
  };
}

export async function cancelAllUnfinishedSubmissions(input: { userId: string }) {
  const userId = parseUserId(input.userId);
  const submissions = await prisma.meterSubmission.findMany({
    where: {
      userId,
      status: {
        in: [SubmissionStatus.DRAFT, SubmissionStatus.PENDING_CONFIRMATION]
      }
    },
    include: {
      files: true
    }
  });

  if (!submissions.length) {
    return {
      cancelledCount: 0,
      storageKeys: []
    };
  }

  const submissionIds = submissions.map((item) => item.id);
  const storageKeys = submissions.flatMap((item) => item.files.map((file) => file.storageKey));

  await prisma.$transaction([
    prisma.submissionStatusHistory.deleteMany({
      where: {
        submissionId: {
          in: submissionIds
        }
      }
    }),
    prisma.fileEntity.deleteMany({
      where: {
        submissionId: {
          in: submissionIds
        }
      }
    }),
    prisma.meterSubmission.deleteMany({
      where: {
        id: {
          in: submissionIds
        }
      }
    })
  ]);

  return {
    cancelledCount: submissions.length,
    storageKeys
  };
}

export async function listMySubmissions(input: {
  userId: string;
  limit: number;
  status?: SubmissionStatus;
}) {
  return prisma.meterSubmission.findMany({
    where: {
      userId: parseUserId(input.userId),
      status: input.status
    },
    include: {
      equipmentType: true
    },
    orderBy: { createdAt: "desc" },
    take: input.limit
  });
}

export async function listEquipmentTypes() {
  return prisma.equipmentType.findMany({
    orderBy: { id: "asc" }
  });
}

export async function getLatestPendingSubmission(userId: string) {
  return prisma.meterSubmission.findFirst({
    where: {
      userId: parseUserId(userId),
      status: SubmissionStatus.PENDING_CONFIRMATION
    },
    include: {
      equipmentType: true
    },
    orderBy: { createdAt: "desc" }
  });
}
