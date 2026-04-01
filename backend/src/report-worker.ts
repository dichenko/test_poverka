import { CronJob } from "cron";
import { prisma } from "./common/prisma";
import { logger } from "./common/logger";
import { reportEnv } from "./report-worker/config";
import { resolveReportDate } from "./report-worker/date.utils";
import { GeneratedReportsRepository } from "./report-worker/generated-reports.repository";
import { startReportWorkerHttpServer } from "./report-worker/http-server";
import { createReportsRegistry } from "./report-worker/reports-registry";
import { ReportsRunner } from "./report-worker/reports-runner";
import { OrganizationsBalanceStartOfDaySyncRepository } from "./report-worker/organizations-balance-start-of-day-sync.repository";
import { MailRunsRepository } from "./report-mail/mail-runs.repository";
import { ReportRunsRepository } from "./report-mail/report-runs.repository";

interface CliOptions {
  mode: "worker" | "generate";
  reportCode?: string;
  date?: string;
  organizationId?: bigint;
}

function readFlag(args: string[], name: string) {
  const prefixed = `${name}=`;
  const byEquals = args.find((arg) => arg.startsWith(prefixed));
  if (byEquals) {
    return byEquals.slice(prefixed.length).trim();
  }

  const index = args.findIndex((arg) => arg === name);
  if (index >= 0) {
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      return next.trim();
    }
  }

  return undefined;
}

function parseCliOptions(rawArgs: string[]): CliOptions {
  const args = rawArgs.map((item) => item.trim()).filter(Boolean);
  const command = args[0];
  const flagReportCode = readFlag(args, "--report");
  const flagDate = readFlag(args, "--date");
  const flagOrganizationId = readFlag(args, "--organizationId");

  if (command !== "generate-report" && !flagReportCode && !flagDate && !flagOrganizationId) {
    return { mode: "worker" };
  }

  let positionalReportCode: string | undefined;
  let positionalDate: string | undefined;

  if (command === "generate-report") {
    const positionals = args
      .slice(1)
      .filter((item) => !item.startsWith("--"))
      .map((item) => item.trim());

    positionalReportCode = positionals[0];
    positionalDate = positionals[1];
  }

  const organizationIdValue = flagOrganizationId;
  let organizationId: bigint | undefined;
  if (organizationIdValue) {
    try {
      organizationId = BigInt(organizationIdValue);
    } catch {
      throw new Error(`Invalid organizationId value: "${organizationIdValue}". Expected positive integer.`);
    }
    if (organizationId <= 0n) {
      throw new Error(`Invalid organizationId value: "${organizationIdValue}". Expected positive integer.`);
    }
  }

  return {
    mode: "generate",
    reportCode: flagReportCode ?? positionalReportCode,
    date: flagDate ?? positionalDate,
    organizationId
  };
}

function logRunResult(result: Awaited<ReturnType<ReportsRunner["run"]>>) {
  logger.info(
    {
      date: result.date,
      trigger: result.trigger,
      lockAcquired: result.lockAcquired,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      reports: result.items.map((item) => ({
        reportCode: item.reportCode,
        organizationId: item.organizationId ?? null,
        organizationName: item.organizationName ?? null,
        status: item.status,
        rowsCount: item.rowsCount,
        filePath: item.absolutePath,
        publicUrl: item.publicUrl
      }))
    },
    "Report run summary"
  );
}

function parseIso(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

function isRunSuccessful(result: Awaited<ReturnType<ReportsRunner["run"]>>) {
  if (!result.lockAcquired) {
    return false;
  }
  if (!result.items.length) {
    return false;
  }
  return result.items.every((item) => item.status === "success");
}

async function handleReportRunCompletion(input: {
  result: Awaited<ReturnType<ReportsRunner["run"]>>;
  reportRunsRepository: ReportRunsRepository;
  mailRunsRepository: MailRunsRepository;
  autoMailEligible: boolean;
}) {
  if (!input.result.lockAcquired) {
    logger.warn(
      {
        reportDate: input.result.date,
        trigger: input.result.trigger
      },
      "Report run completion skipped because lock was not acquired"
    );
    return;
  }

  if (!input.autoMailEligible) {
    logger.info(
      {
        reportDate: input.result.date,
        trigger: input.result.trigger
      },
      "Report run completion marker skipped because run is partial"
    );
    return;
  }

  const successfulReports = input.result.items.filter((item) => item.status === "success").length;
  const failedItems = input.result.items.filter((item) => item.status === "error");
  const failedReports = failedItems.length;
  const status = isRunSuccessful(input.result) ? "SUCCESS" : "FAILED";

  let autoMailRunEnqueued = false;

  if (status === "SUCCESS" && input.autoMailEligible) {
    try {
      const openRun = await input.mailRunsRepository.findOpenRunByDate(input.result.date);
      if (openRun) {
        autoMailRunEnqueued = true;
      } else {
        await input.mailRunsRepository.createRun({
          reportDate: input.result.date,
          trigger: "auto-after-report",
          force: false,
          requestedBy: "report-worker"
        });
        autoMailRunEnqueued = true;
      }
    } catch (error) {
      logger.error(
        {
          err: error,
          reportDate: input.result.date
        },
        "Failed to enqueue automatic mail run"
      );
    }
  }

  await input.reportRunsRepository.upsertByDate({
    reportDate: input.result.date,
    trigger: input.result.trigger,
    status,
    totalReports: input.result.items.length,
    successfulReports,
    failedReports,
    startedAt: parseIso(input.result.startedAt),
    finishedAt: parseIso(input.result.finishedAt),
    errorText:
      failedItems.length > 0
        ? failedItems
            .map((item) => `${item.reportCode}${item.organizationId ? `:${item.organizationId}` : ""}: ${item.errorText}`)
            .join("\n")
        : null,
    autoMailRunEnqueued
  });
}

async function runCliGeneration(
  runner: ReportsRunner,
  options: CliOptions,
  reportRunsRepository: ReportRunsRepository,
  mailRunsRepository: MailRunsRepository
) {
  const date = resolveReportDate(options.date, reportEnv.REPORTS_TZ);

  const result = await runner.run({
    date,
    reportCode: options.reportCode,
    organizationId: options.organizationId,
    trigger: "manual-cli"
  });

  logRunResult(result);
  await handleReportRunCompletion({
    result,
    reportRunsRepository,
    mailRunsRepository,
    autoMailEligible: !options.reportCode && !options.organizationId
  });

  if (!result.lockAcquired) {
    logger.error("Report generation is already running in another process.");
    process.exitCode = 1;
    return;
  }

  if (result.items.some((item) => item.status === "error")) {
    process.exitCode = 1;
  }
}

async function runWorker(
  runner: ReportsRunner,
  reportRunsRepository: ReportRunsRepository,
  mailRunsRepository: MailRunsRepository
) {
  const httpServer = startReportWorkerHttpServer({
    port: reportEnv.REPORTS_HTTP_PORT,
    internalApiToken: reportEnv.INTERNAL_API_TOKEN,
    reportsTimeZone: reportEnv.REPORTS_TZ,
    runner,
    logger,
    onRunCompleted: async ({ result, reportCode, organizationId }) => {
      await handleReportRunCompletion({
        result,
        reportRunsRepository,
        mailRunsRepository,
        autoMailEligible: !reportCode && !organizationId
      });
    }
  });

  const cronJob = CronJob.from({
    cronTime: reportEnv.REPORTS_CRON,
    start: true,
    timeZone: reportEnv.REPORTS_TZ,
    onTick: async () => {
      try {
        const date = resolveReportDate(undefined, reportEnv.REPORTS_TZ);
        const result = await runner.run({
          date,
          trigger: "cron"
        });
        logRunResult(result);
        await handleReportRunCompletion({
          result,
          reportRunsRepository,
          mailRunsRepository,
          autoMailEligible: true
        });
      } catch (error) {
        logger.error({ err: error }, "Cron report run failed");
      }
    }
  });

  logger.info(
    {
      reportsCron: reportEnv.REPORTS_CRON,
      reportsTimeZone: reportEnv.REPORTS_TZ,
      reportsStorageDir: reportEnv.REPORTS_STORAGE_DIR,
      reportsPublicBaseUrl: reportEnv.REPORTS_PUBLIC_BASE_URL,
      httpPort: reportEnv.REPORTS_HTTP_PORT
    },
    "Report worker started"
  );

  let isShuttingDown = false;

  const shutdown = async (signal: string) => {
    if (isShuttingDown) {
      return;
    }
    isShuttingDown = true;
    logger.info({ signal }, "Report worker shutting down");
    cronJob.stop();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

async function start() {
  const cli = parseCliOptions(process.argv.slice(2));

  await prisma.$connect();

  const reports = createReportsRegistry({
    prisma,
    logger,
    reportsStorageDir: reportEnv.REPORTS_STORAGE_DIR,
    reportsPublicBaseUrl: reportEnv.REPORTS_PUBLIC_BASE_URL,
    reportsTimeZone: reportEnv.REPORTS_TZ
  });
  const generatedReportsRepository = new GeneratedReportsRepository(prisma);
  const organizationsBalanceStartOfDaySyncRepository = new OrganizationsBalanceStartOfDaySyncRepository(prisma);
  const reportRunsRepository = new ReportRunsRepository(prisma);
  const mailRunsRepository = new MailRunsRepository(prisma);
  const runner = new ReportsRunner({
    databaseUrl: reportEnv.DATABASE_URL,
    lockId: reportEnv.REPORTS_LOCK_ID,
    reports,
    generatedReportsRepository,
    organizationsBalanceStartOfDaySyncRepository,
    logger,
    reportsStorageDir: reportEnv.REPORTS_STORAGE_DIR,
    reportsPublicBaseUrl: reportEnv.REPORTS_PUBLIC_BASE_URL
  });

  if (cli.mode === "generate") {
    await runCliGeneration(runner, cli, reportRunsRepository, mailRunsRepository);
    await prisma.$disconnect();
    return;
  }

  await runWorker(runner, reportRunsRepository, mailRunsRepository);
}

start().catch(async (error) => {
  logger.error({ err: error }, "Report worker failed to start");
  await prisma.$disconnect();
  process.exit(1);
});
