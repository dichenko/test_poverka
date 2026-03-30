import { GeneratedReportStatus, type PrismaClient } from "@prisma/client";

const ERROR_TEXT_MAX_LENGTH = 8000;

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function toErrorText(value: unknown) {
  const text = value instanceof Error ? value.stack || value.message : String(value);
  return text.slice(0, ERROR_TEXT_MAX_LENGTH);
}

export class GeneratedReportsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async markPending(input: {
    reportCode: string;
    reportDate: string;
    fileName: string;
    filePath: string;
    publicUrl: string;
  }) {
    const startedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);

    await this.prisma.generatedReport.upsert({
      where: {
        reportCode_reportDate: {
          reportCode: input.reportCode,
          reportDate
        }
      },
      create: {
        reportCode: input.reportCode,
        reportDate,
        fileName: input.fileName,
        filePath: input.filePath,
        publicUrl: input.publicUrl,
        status: GeneratedReportStatus.PENDING,
        rowsCount: 0,
        errorText: null,
        startedAt,
        finishedAt: null
      },
      update: {
        fileName: input.fileName,
        filePath: input.filePath,
        publicUrl: input.publicUrl,
        status: GeneratedReportStatus.PENDING,
        rowsCount: 0,
        errorText: null,
        startedAt,
        finishedAt: null
      }
    });
  }

  async markSuccess(input: {
    reportCode: string;
    reportDate: string;
    fileName: string;
    filePath: string;
    publicUrl: string;
    rowsCount: number;
  }) {
    const finishedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);

    await this.prisma.generatedReport.update({
      where: {
        reportCode_reportDate: {
          reportCode: input.reportCode,
          reportDate
        }
      },
      data: {
        fileName: input.fileName,
        filePath: input.filePath,
        publicUrl: input.publicUrl,
        status: GeneratedReportStatus.SUCCESS,
        rowsCount: input.rowsCount,
        errorText: null,
        finishedAt
      }
    });
  }

  async markError(input: { reportCode: string; reportDate: string; error: unknown }) {
    const finishedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);

    await this.prisma.generatedReport.update({
      where: {
        reportCode_reportDate: {
          reportCode: input.reportCode,
          reportDate
        }
      },
      data: {
        status: GeneratedReportStatus.ERROR,
        rowsCount: 0,
        errorText: toErrorText(input.error),
        finishedAt
      }
    });
  }
}
