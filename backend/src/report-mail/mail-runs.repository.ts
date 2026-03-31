import { MailRunStatus, type PrismaClient } from "@prisma/client";

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export class MailRunsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createRun(input: {
    reportDate: string;
    trigger: string;
    force: boolean;
    requestedBy?: string | null;
  }) {
    return this.prisma.mailRun.create({
      data: {
        reportDate: toDateOnly(input.reportDate),
        trigger: input.trigger,
        force: input.force,
        requestedBy: input.requestedBy ?? null,
        status: MailRunStatus.PENDING
      }
    });
  }

  async findOpenRunByDate(reportDate: string) {
    return this.prisma.mailRun.findFirst({
      where: {
        reportDate: toDateOnly(reportDate),
        status: {
          in: [MailRunStatus.PENDING, MailRunStatus.PROCESSING]
        }
      },
      orderBy: {
        createdAt: "desc"
      }
    });
  }

  async claimNextPendingRun() {
    const row = await this.prisma.mailRun.findFirst({
      where: {
        status: MailRunStatus.PENDING
      },
      orderBy: {
        createdAt: "asc"
      }
    });

    if (!row) {
      return null;
    }

    const updated = await this.prisma.mailRun.updateMany({
      where: {
        id: row.id,
        status: MailRunStatus.PENDING
      },
      data: {
        status: MailRunStatus.PROCESSING,
        startedAt: new Date(),
        errorText: null
      }
    });

    if (updated.count === 0) {
      return null;
    }

    return this.prisma.mailRun.findUnique({
      where: {
        id: row.id
      }
    });
  }

  async claimById(id: bigint) {
    const row = await this.prisma.mailRun.findUnique({
      where: { id }
    });
    if (!row) {
      return null;
    }

    const canClaim = row.status === MailRunStatus.PENDING || row.status === MailRunStatus.FAILED;
    if (!canClaim) {
      return null;
    }

    const updated = await this.prisma.mailRun.updateMany({
      where: {
        id,
        status: {
          in: [MailRunStatus.PENDING, MailRunStatus.FAILED]
        }
      },
      data: {
        status: MailRunStatus.PROCESSING,
        startedAt: new Date(),
        errorText: null
      }
    });

    if (!updated.count) {
      return null;
    }

    return this.prisma.mailRun.findUnique({
      where: { id }
    });
  }

  async markCompleted(input: {
    runId: bigint;
    totalDeliveries: number;
    sentCount: number;
    failedCount: number;
  }) {
    return this.prisma.mailRun.update({
      where: {
        id: input.runId
      },
      data: {
        status: MailRunStatus.COMPLETED,
        totalDeliveries: input.totalDeliveries,
        sentCount: input.sentCount,
        failedCount: input.failedCount,
        finishedAt: new Date(),
        errorText: null
      }
    });
  }

  async markFailed(input: {
    runId: bigint;
    totalDeliveries: number;
    sentCount: number;
    failedCount: number;
    errorText: string;
  }) {
    return this.prisma.mailRun.update({
      where: {
        id: input.runId
      },
      data: {
        status: MailRunStatus.FAILED,
        totalDeliveries: input.totalDeliveries,
        sentCount: input.sentCount,
        failedCount: input.failedCount,
        finishedAt: new Date(),
        errorText: input.errorText
      }
    });
  }

  async findById(id: bigint) {
    return this.prisma.mailRun.findUnique({
      where: { id }
    });
  }

  async listByDate(reportDate: string) {
    return this.prisma.mailRun.findMany({
      where: {
        reportDate: toDateOnly(reportDate)
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
  }
}
