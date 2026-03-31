import { ReportRunStatus, type PrismaClient } from "@prisma/client";

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

const ERROR_TEXT_MAX_LENGTH = 8000;

function truncateError(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  return value.slice(0, ERROR_TEXT_MAX_LENGTH);
}

export class ReportRunsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertByDate(input: {
    reportDate: string;
    trigger: string;
    status: "SUCCESS" | "FAILED";
    totalReports: number;
    successfulReports: number;
    failedReports: number;
    startedAt: Date;
    finishedAt: Date;
    errorText?: string | null;
    autoMailRunEnqueued: boolean;
  }) {
    const reportDate = toDateOnly(input.reportDate);
    const status = input.status === "SUCCESS" ? ReportRunStatus.SUCCESS : ReportRunStatus.FAILED;

    return this.prisma.reportRun.upsert({
      where: {
        reportDate
      },
      create: {
        reportDate,
        trigger: input.trigger,
        status,
        totalReports: input.totalReports,
        successfulReports: input.successfulReports,
        failedReports: input.failedReports,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        errorText: truncateError(input.errorText),
        autoMailRunEnqueued: input.autoMailRunEnqueued
      },
      update: {
        trigger: input.trigger,
        status,
        totalReports: input.totalReports,
        successfulReports: input.successfulReports,
        failedReports: input.failedReports,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        errorText: truncateError(input.errorText),
        autoMailRunEnqueued: input.autoMailRunEnqueued
      }
    });
  }
}
