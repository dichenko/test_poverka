import type { PrismaClient } from "@prisma/client";
import { createArshinReportGenerator } from "./arshin-report.generator";
import type { ReportGenerator, ReportLogger } from "./report.types";

interface CreateReportsRegistryInput {
  prisma: PrismaClient;
  logger: ReportLogger;
  reportsStorageDir: string;
  reportsPublicBaseUrl: string;
  reportsTimeZone: string;
}

export function createReportsRegistry(input: CreateReportsRegistryInput): ReportGenerator[] {
  return [
    createArshinReportGenerator({
      prisma: input.prisma,
      logger: input.logger,
      reportsStorageDir: input.reportsStorageDir,
      reportsPublicBaseUrl: input.reportsPublicBaseUrl,
      reportsTimeZone: input.reportsTimeZone
    })
  ];
}

