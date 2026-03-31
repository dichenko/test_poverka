import type { GeneratedReportsRepository } from "./generated-reports.repository";

export interface GeneratedReportResult {
  fileName: string;
  absolutePath: string;
  publicUrl: string;
  rowsCount: number;
}

export type ReportTrigger = "cron" | "manual-cli" | "manual-http";

export interface ReportBatchGenerateInput {
  reportDate: string;
  trigger: ReportTrigger;
  organizationId?: bigint;
  generatedReportsRepository: GeneratedReportsRepository;
}

export interface ReportGenerator {
  code: string;
  title: string;
  getFileName(reportDate: string): string;
  generate(reportDate: string): Promise<GeneratedReportResult>;
  generateBatch?(input: ReportBatchGenerateInput): Promise<ReportRunItemResult[]>;
}

export interface ReportRunItemResult {
  reportCode: string;
  reportTitle: string;
  status: "success" | "error";
  fileName: string;
  absolutePath: string;
  publicUrl: string;
  rowsCount: number;
  errorText: string | null;
  organizationId?: string | null;
  organizationName?: string | null;
}

export interface ReportRunResult {
  date: string;
  trigger: ReportTrigger;
  lockAcquired: boolean;
  startedAt: string;
  finishedAt: string;
  items: ReportRunItemResult[];
}

export interface ReportLogger {
  info(payload: unknown, msg?: string): void;
  warn(payload: unknown, msg?: string): void;
  error(payload: unknown, msg?: string): void;
}
