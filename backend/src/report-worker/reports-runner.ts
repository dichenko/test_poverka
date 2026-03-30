import fs from "fs/promises";
import { buildReportPaths } from "./report-paths";
import { ReportExecutionLock } from "./report-execution-lock";
import type { GeneratedReportsRepository } from "./generated-reports.repository";
import type { ReportGenerator, ReportLogger, ReportRunItemResult, ReportRunResult } from "./report.types";

interface ReportsRunnerInput {
  databaseUrl: string;
  lockId: bigint;
  reports: ReportGenerator[];
  generatedReportsRepository: GeneratedReportsRepository;
  logger: ReportLogger;
  reportsStorageDir: string;
  reportsPublicBaseUrl: string;
}

interface RunReportsInput {
  date: string;
  trigger: "cron" | "manual-cli" | "manual-http";
  reportCode?: string;
}

function normalizeReportCode(value: string) {
  return value.trim().toLowerCase();
}

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export class ReportsRunner {
  private readonly reportsByCode: Map<string, ReportGenerator>;
  private readonly lock: ReportExecutionLock;
  private isRunning = false;

  constructor(private readonly input: ReportsRunnerInput) {
    this.reportsByCode = new Map(
      this.input.reports.map((report) => [normalizeReportCode(report.code), report] as const)
    );
    this.lock = new ReportExecutionLock(input.databaseUrl, input.lockId);
  }

  private resolveReports(reportCode: string | undefined) {
    if (!reportCode) {
      return this.input.reports;
    }

    const normalizedCode = normalizeReportCode(reportCode);
    const report = this.reportsByCode.get(normalizedCode);

    if (!report) {
      throw new Error(`Unknown report code: "${reportCode}".`);
    }

    return [report];
  }

  async run(input: RunReportsInput): Promise<ReportRunResult> {
    const startedAt = new Date();
    const reportList = this.resolveReports(input.reportCode);

    if (this.isRunning) {
      this.input.logger.warn(
        {
          trigger: input.trigger,
          date: input.date,
          reportCode: input.reportCode ?? null
        },
        "Report generation is already running in-memory, skipping new start"
      );
      const finishedAt = new Date();
      return {
        date: input.date,
        trigger: input.trigger,
        lockAcquired: false,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        items: []
      };
    }

    this.isRunning = true;
    let lockAcquired = false;
    const items: ReportRunItemResult[] = [];

    try {
      lockAcquired = await this.lock.tryAcquire();
      if (!lockAcquired) {
        this.input.logger.warn(
          {
            trigger: input.trigger,
            date: input.date,
            reportCode: input.reportCode ?? null
          },
          "Report generation lock is already acquired by another process"
        );
        const finishedAt = new Date();
        return {
          date: input.date,
          trigger: input.trigger,
          lockAcquired: false,
          startedAt: startedAt.toISOString(),
          finishedAt: finishedAt.toISOString(),
          items: []
        };
      }

      for (const report of reportList) {
        const fileName = report.getFileName(input.date);
        const plannedPaths = buildReportPaths({
          storageDir: this.input.reportsStorageDir,
          publicBaseUrl: this.input.reportsPublicBaseUrl,
          reportCode: report.code,
          fileName
        });

        let pendingSaved = false;

        try {
          await this.input.generatedReportsRepository.markPending({
            reportCode: report.code,
            reportDate: input.date,
            fileName: plannedPaths.fileName,
            filePath: plannedPaths.absolutePath,
            publicUrl: plannedPaths.publicUrl
          });
          pendingSaved = true;

          this.input.logger.info(
            {
              reportCode: report.code,
              reportTitle: report.title,
              date: input.date,
              trigger: input.trigger
            },
            "Start report generation"
          );

          const result = await report.generate(input.date);

          await this.input.generatedReportsRepository.markSuccess({
            reportCode: report.code,
            reportDate: input.date,
            fileName: result.fileName,
            filePath: result.absolutePath,
            publicUrl: result.publicUrl,
            rowsCount: result.rowsCount
          });

          this.input.logger.info(
            {
              reportCode: report.code,
              date: input.date,
              rowsCount: result.rowsCount,
              filePath: result.absolutePath,
              publicUrl: result.publicUrl
            },
            "Generation finished successfully"
          );

          items.push({
            reportCode: report.code,
            reportTitle: report.title,
            status: "success",
            fileName: result.fileName,
            absolutePath: result.absolutePath,
            publicUrl: result.publicUrl,
            rowsCount: result.rowsCount,
            errorText: null
          });
        } catch (error) {
          await fs.rm(plannedPaths.absolutePath, { force: true }).catch(() => undefined);

          if (pendingSaved) {
            await this.input.generatedReportsRepository.markError({
              reportCode: report.code,
              reportDate: input.date,
              error
            });
          } else {
            this.input.logger.error(
              {
                err: error,
                reportCode: report.code,
                date: input.date
              },
              "Failed before generated_reports pending metadata was saved"
            );
          }

          this.input.logger.error(
            {
              err: error,
              reportCode: report.code,
              date: input.date
            },
            "Report generation failed"
          );

          items.push({
            reportCode: report.code,
            reportTitle: report.title,
            status: "error",
            fileName: plannedPaths.fileName,
            absolutePath: plannedPaths.absolutePath,
            publicUrl: plannedPaths.publicUrl,
            rowsCount: 0,
            errorText: toErrorText(error)
          });
        }
      }
    } finally {
      this.isRunning = false;
      if (lockAcquired) {
        await this.lock.release();
      }
    }

    const finishedAt = new Date();
    return {
      date: input.date,
      trigger: input.trigger,
      lockAcquired,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      items
    };
  }
}
