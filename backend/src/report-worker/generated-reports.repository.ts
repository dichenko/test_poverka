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

  private buildScopeWhere(input: {
    reportCode: string;
    reportDate: Date;
    organizationId?: bigint | null;
  }) {
    return {
      reportCode: input.reportCode,
      reportDate: input.reportDate,
      organizationId: input.organizationId ?? null
    };
  }

  private async findReportId(input: {
    reportCode: string;
    reportDate: Date;
    organizationId?: bigint | null;
  }) {
    const found = await this.prisma.generatedReport.findFirst({
      where: this.buildScopeWhere(input),
      select: {
        id: true
      }
    });

    return found?.id ?? null;
  }

  async markPending(input: {
    reportCode: string;
    reportDate: string;
    organizationId?: bigint | null;
    fileName: string;
    filePath: string;
    publicToken: string;
    publicUrl: string;
  }) {
    const startedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);
    const organizationId = input.organizationId ?? null;
    const existingId = await this.findReportId({
      reportCode: input.reportCode,
      reportDate,
      organizationId
    });

    if (existingId) {
      await this.prisma.generatedReport.update({
        where: {
          id: existingId
        },
        data: {
          organizationId,
          fileName: input.fileName,
          filePath: input.filePath,
          publicToken: input.publicToken,
          publicUrl: input.publicUrl,
          status: GeneratedReportStatus.PENDING,
          rowsCount: 0,
          errorText: null,
          startedAt,
          finishedAt: null
        }
      });
      return;
    }

    await this.prisma.generatedReport.create({
      data: {
        reportCode: input.reportCode,
        reportDate,
        organizationId,
        fileName: input.fileName,
        filePath: input.filePath,
        publicToken: input.publicToken,
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
    organizationId?: bigint | null;
    fileName: string;
    filePath: string;
    publicToken: string;
    publicUrl: string;
    rowsCount: number;
  }) {
    const finishedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);
    const organizationId = input.organizationId ?? null;
    const existingId = await this.findReportId({
      reportCode: input.reportCode,
      reportDate,
      organizationId
    });

    if (!existingId) {
      throw new Error(
        `generated_reports row is missing for markSuccess: reportCode=${input.reportCode}, reportDate=${input.reportDate}, organizationId=${organizationId?.toString() ?? "null"}`
      );
    }

    await this.prisma.generatedReport.update({
      where: {
        id: existingId
      },
      data: {
        organizationId,
        fileName: input.fileName,
        filePath: input.filePath,
        publicToken: input.publicToken,
        publicUrl: input.publicUrl,
        status: GeneratedReportStatus.SUCCESS,
        rowsCount: input.rowsCount,
        errorText: null,
        finishedAt
      }
    });
  }

  async markError(input: {
    reportCode: string;
    reportDate: string;
    organizationId?: bigint | null;
    error: unknown;
  }) {
    const finishedAt = new Date();
    const reportDate = toDateOnly(input.reportDate);
    const organizationId = input.organizationId ?? null;
    const existingId = await this.findReportId({
      reportCode: input.reportCode,
      reportDate,
      organizationId
    });

    if (!existingId) {
      throw new Error(
        `generated_reports row is missing for markError: reportCode=${input.reportCode}, reportDate=${input.reportDate}, organizationId=${organizationId?.toString() ?? "null"}`
      );
    }

    await this.prisma.generatedReport.update({
      where: {
        id: existingId
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
