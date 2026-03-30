export interface GeneratedReportResult {
  fileName: string;
  absolutePath: string;
  publicUrl: string;
  rowsCount: number;
}

export interface ReportGenerator {
  code: string;
  title: string;
  getFileName(reportDate: string): string;
  generate(reportDate: string): Promise<GeneratedReportResult>;
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
}

export interface ReportRunResult {
  date: string;
  trigger: "cron" | "manual-cli" | "manual-http";
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

