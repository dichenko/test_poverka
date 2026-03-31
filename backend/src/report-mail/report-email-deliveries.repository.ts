import {
  ReportEmailDeliveryStatus,
  type Prisma,
  type PrismaClient,
  type ReportRecipientType
} from "@prisma/client";

const ERROR_TEXT_MAX_LENGTH = 8000;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toErrorText(value: unknown) {
  const text = value instanceof Error ? value.stack || value.message : String(value);
  return text.slice(0, ERROR_TEXT_MAX_LENGTH);
}

export interface DeliveryRecipient {
  recipientType: "admin" | "organization";
  recipientEmail: string;
  recipientKey: string;
  organizationId: bigint | null;
}

function toRecipientType(value: "admin" | "organization"): ReportRecipientType {
  return value === "admin" ? "ADMIN" : "ORGANIZATION";
}

export class ReportEmailDeliveriesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  private scopeWhere(input: {
    reportDate: string;
    reportType: string;
    fileName: string;
    recipientKey: string;
  }) {
    return {
      reportDate_reportType_fileName_recipientKey: {
        reportDate: toDateOnly(input.reportDate),
        reportType: input.reportType,
        fileName: input.fileName,
        recipientKey: input.recipientKey
      }
    } as const;
  }

  async ensureDelivery(input: {
    reportDate: string;
    reportType: string;
    fileName: string;
    filePath: string;
    recipient: DeliveryRecipient;
    force: boolean;
  }) {
    const existing = await this.prisma.reportEmailDelivery.findUnique({
      where: this.scopeWhere({
        reportDate: input.reportDate,
        reportType: input.reportType,
        fileName: input.fileName,
        recipientKey: input.recipient.recipientKey
      })
    });

    if (!existing) {
      return this.prisma.reportEmailDelivery.create({
        data: {
          reportDate: toDateOnly(input.reportDate),
          reportType: input.reportType,
          fileName: input.fileName,
          filePath: input.filePath,
          orgId: input.recipient.organizationId,
          recipientEmail: input.recipient.recipientEmail,
          recipientKey: input.recipient.recipientKey,
          recipientType: toRecipientType(input.recipient.recipientType),
          status: ReportEmailDeliveryStatus.PENDING,
          lastError: null,
          sentAt: null
        }
      });
    }

    const updateData: Prisma.ReportEmailDeliveryUncheckedUpdateInput = {
      filePath: input.filePath,
      orgId: input.recipient.organizationId,
      recipientEmail: input.recipient.recipientEmail,
      recipientType: toRecipientType(input.recipient.recipientType)
    };

    if (input.force) {
      updateData.status = ReportEmailDeliveryStatus.PENDING;
      updateData.lastError = null;
      updateData.sentAt = null;
    }

    return this.prisma.reportEmailDelivery.update({
      where: {
        id: existing.id
      },
      data: updateData
    });
  }

  async markRecipientResolutionFailed(input: {
    reportDate: string;
    reportType: string;
    fileName: string;
    filePath: string;
    recipientType: "admin" | "organization";
    recipientKey: string;
    organizationId: bigint | null;
    errorMessage: string;
    force: boolean;
  }) {
    const existing = await this.prisma.reportEmailDelivery.findUnique({
      where: this.scopeWhere(input)
    });

    if (!existing) {
      return this.prisma.reportEmailDelivery.create({
        data: {
          reportDate: toDateOnly(input.reportDate),
          reportType: input.reportType,
          fileName: input.fileName,
          filePath: input.filePath,
          orgId: input.organizationId,
          recipientEmail: null,
          recipientKey: input.recipientKey,
          recipientType: toRecipientType(input.recipientType),
          status: ReportEmailDeliveryStatus.FAILED,
          attemptsCount: 1,
          lastError: input.errorMessage.slice(0, ERROR_TEXT_MAX_LENGTH),
          sentAt: null
        }
      });
    }

    if (existing.status === ReportEmailDeliveryStatus.SENT && !input.force) {
      return existing;
    }

    return this.prisma.reportEmailDelivery.update({
      where: {
        id: existing.id
      },
      data: {
        filePath: input.filePath,
        orgId: input.organizationId,
        status: ReportEmailDeliveryStatus.FAILED,
        attemptsCount: existing.attemptsCount + 1,
        lastError: input.errorMessage.slice(0, ERROR_TEXT_MAX_LENGTH),
        sentAt: null
      }
    });
  }

  async listForProcessing(input: {
    reportDate: string;
    force: boolean;
    maxAttempts: number;
    fileName?: string;
    deliveryId?: bigint;
  }) {
    const statuses = input.force
      ? [
          ReportEmailDeliveryStatus.PENDING,
          ReportEmailDeliveryStatus.FAILED,
          ReportEmailDeliveryStatus.SENT
        ]
      : [ReportEmailDeliveryStatus.PENDING, ReportEmailDeliveryStatus.FAILED];

    const where: Prisma.ReportEmailDeliveryWhereInput = {
      reportDate: toDateOnly(input.reportDate),
      fileName: input.fileName,
      id: input.deliveryId,
      recipientEmail: {
        not: null
      },
      status: {
        in: statuses
      },
      ...(input.force
        ? {}
        : {
            attemptsCount: {
              lt: input.maxAttempts
            }
          })
    };

    return this.prisma.reportEmailDelivery.findMany({
      where,
      orderBy: [{ recipientType: "asc" }, { fileName: "asc" }, { id: "asc" }]
    });
  }

  async claimForProcessing(id: bigint, force: boolean) {
    const allowedStatuses = force
      ? [
          ReportEmailDeliveryStatus.PENDING,
          ReportEmailDeliveryStatus.FAILED,
          ReportEmailDeliveryStatus.SENT
        ]
      : [ReportEmailDeliveryStatus.PENDING, ReportEmailDeliveryStatus.FAILED];

    const updated = await this.prisma.reportEmailDelivery.updateMany({
      where: {
        id,
        status: {
          in: allowedStatuses
        }
      },
      data: {
        status: ReportEmailDeliveryStatus.PROCESSING
      }
    });

    return updated.count > 0;
  }

  async markSent(input: {
    deliveryId: bigint;
    mailRunId: bigint | null;
    forced: boolean;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.reportEmailDelivery.findUnique({
        where: { id: input.deliveryId },
        select: { attemptsCount: true }
      });
      if (!current) {
        throw new Error(`Delivery not found: ${input.deliveryId.toString()}`);
      }

      const attemptNo = current.attemptsCount + 1;
      const sentAt = new Date();

      const updated = await tx.reportEmailDelivery.update({
        where: { id: input.deliveryId },
        data: {
          status: ReportEmailDeliveryStatus.SENT,
          attemptsCount: attemptNo,
          lastError: null,
          sentAt
        }
      });

      await tx.reportEmailDeliveryAttempt.create({
        data: {
          deliveryId: input.deliveryId,
          mailRunId: input.mailRunId,
          attemptNo,
          forced: input.forced,
          status: ReportEmailDeliveryStatus.SENT,
          errorText: null
        }
      });

      return updated;
    });
  }

  async markFailed(input: {
    deliveryId: bigint;
    mailRunId: bigint | null;
    forced: boolean;
    error: unknown;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.reportEmailDelivery.findUnique({
        where: { id: input.deliveryId },
        select: { attemptsCount: true }
      });
      if (!current) {
        throw new Error(`Delivery not found: ${input.deliveryId.toString()}`);
      }

      const attemptNo = current.attemptsCount + 1;
      const errorText = toErrorText(input.error);

      const updated = await tx.reportEmailDelivery.update({
        where: { id: input.deliveryId },
        data: {
          status: ReportEmailDeliveryStatus.FAILED,
          attemptsCount: attemptNo,
          lastError: errorText,
          sentAt: null
        }
      });

      await tx.reportEmailDeliveryAttempt.create({
        data: {
          deliveryId: input.deliveryId,
          mailRunId: input.mailRunId,
          attemptNo,
          forced: input.forced,
          status: ReportEmailDeliveryStatus.FAILED,
          errorText
        }
      });

      return updated;
    });
  }

  async findById(id: bigint) {
    return this.prisma.reportEmailDelivery.findUnique({
      where: { id }
    });
  }

  async listByDate(input: {
    reportDate: string;
    status?: ReportEmailDeliveryStatus;
    organizationId?: bigint;
    fileName?: string;
  }) {
    return this.prisma.reportEmailDelivery.findMany({
      where: {
        reportDate: toDateOnly(input.reportDate),
        status: input.status,
        orgId: input.organizationId,
        fileName: input.fileName
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  }
}
