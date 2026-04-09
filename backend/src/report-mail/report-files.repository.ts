import { GeneratedReportStatus, type PrismaClient } from "@prisma/client";
import { buildReportPublicUrl } from "../report-worker/report-public-url";

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

export interface StoredReportFile {
  id: bigint;
  reportCode: string;
  reportDate: string;
  organizationId: bigint | null;
  fileName: string;
  filePath: string;
  publicUrl: string;
}

function fromDbDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function resolveReportsPublicBaseUrl() {
  const explicit = process.env.REPORTS_PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const filesBase = process.env.PUBLIC_FILES_BASE_URL?.trim();
  if (filesBase) {
    return `${filesBase.replace(/\/$/, "")}/reports`;
  }

  const backendBase = process.env.BACKEND_PUBLIC_URL?.trim();
  if (backendBase) {
    return `${backendBase.replace(/\/$/, "")}/public/reports`;
  }

  return null;
}

const reportsPublicBaseUrl = resolveReportsPublicBaseUrl();

function resolveStoredPublicUrl(input: { publicUrl: string; publicToken?: string | null }) {
  if (input.publicToken && reportsPublicBaseUrl) {
    return buildReportPublicUrl({
      publicBaseUrl: reportsPublicBaseUrl,
      publicToken: input.publicToken
    });
  }
  return input.publicUrl;
}

export class ReportFilesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listSuccessfulByDate(reportDate: string): Promise<StoredReportFile[]> {
    const rows = await this.prisma.generatedReport.findMany({
      where: {
        reportDate: toDateOnly(reportDate),
        status: GeneratedReportStatus.SUCCESS
      },
      orderBy: [{ reportCode: "asc" }, { organizationId: "asc" }]
    });

    return rows.map((row) => ({
      id: row.id,
      reportCode: row.reportCode,
      reportDate: fromDbDate(row.reportDate),
      organizationId: row.organizationId,
      fileName: row.fileName,
      filePath: row.filePath,
      publicUrl: resolveStoredPublicUrl({
        publicUrl: row.publicUrl,
        publicToken: row.publicToken
      })
    }));
  }

  async findSuccessfulByFileName(fileName: string) {
    const row = await this.prisma.generatedReport.findFirst({
      where: {
        fileName,
        status: GeneratedReportStatus.SUCCESS
      },
      orderBy: [{ reportDate: "desc" }, { id: "desc" }]
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      reportCode: row.reportCode,
      reportDate: fromDbDate(row.reportDate),
      organizationId: row.organizationId,
      fileName: row.fileName,
      filePath: row.filePath,
      publicUrl: resolveStoredPublicUrl({
        publicUrl: row.publicUrl,
        publicToken: row.publicToken
      })
    } satisfies StoredReportFile;
  }

  async findSuccessfulByFilePath(filePath: string) {
    const row = await this.prisma.generatedReport.findFirst({
      where: {
        filePath,
        status: GeneratedReportStatus.SUCCESS
      },
      orderBy: [{ reportDate: "desc" }, { id: "desc" }]
    });

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      reportCode: row.reportCode,
      reportDate: fromDbDate(row.reportDate),
      organizationId: row.organizationId,
      fileName: row.fileName,
      filePath: row.filePath,
      publicUrl: resolveStoredPublicUrl({
        publicUrl: row.publicUrl,
        publicToken: row.publicToken
      })
    } satisfies StoredReportFile;
  }
}
