import { SubmissionStatus, type UserRole, type WaterType } from "@prisma/client";
import { AppError } from "../../common/app-error";
import { prisma } from "../../common/prisma";

function parseMeterValue(rawValue: string) {
  const normalized = rawValue.replace(",", ".");
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new AppError("Invalid meter value.", 400, "INVALID_METER_VALUE");
  }
  return normalized;
}

function parseUserId(raw: string) {
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
  if (!user.organizationId) {
    throw new AppError("Organization is required for submission.", 403, "ORG_REQUIRED");
  }

  const equipmentType = await prisma.equipmentType.findUnique({
    where: { id: input.equipmentTypeId }
  });
  if (!equipmentType) {
    throw new AppError("Equipment type not found.", 400, "EQUIPMENT_TYPE_NOT_FOUND");
  }

  const currentValue = parseMeterValue(input.reading);

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
      status: SubmissionStatus.PENDING_CONFIRMATION
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
  const submission = await prisma.meterSubmission.findUnique({
    where: { id: input.submissionId }
  });
  if (!submission) {
    throw new AppError("Submission not found.", 404, "SUBMISSION_NOT_FOUND");
  }

  const actorUserId = parseUserId(input.actorUserId);

  if (
    input.actorRole !== "ADMIN" &&
    (submission.userId !== actorUserId || submission.status !== SubmissionStatus.PENDING_CONFIRMATION)
  ) {
    throw new AppError("Submission cannot be confirmed.", 403, "SUBMISSION_FORBIDDEN");
  }
  if (submission.status === SubmissionStatus.CONFIRMED) {
    return submission;
  }
  if (submission.status !== SubmissionStatus.PENDING_CONFIRMATION && input.actorRole !== "ADMIN") {
    throw new AppError("Submission is not pending confirmation.", 409, "SUBMISSION_INVALID_STATUS");
  }

  const updated = await prisma.meterSubmission.update({
    where: { id: submission.id },
    data: {
      status: SubmissionStatus.CONFIRMED,
      confirmedAt: new Date()
    }
  });

  await prisma.submissionStatusHistory.create({
    data: {
      submissionId: submission.id,
      oldStatus: submission.status,
      newStatus: SubmissionStatus.CONFIRMED,
      changedByUserId: actorUserId,
      reason: "Confirmed by user."
    }
  });

  return updated;
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
