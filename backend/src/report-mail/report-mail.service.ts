import fs from "fs/promises";
import path from "path";
import {
  MailRunStatus,
  ReportEmailDeliveryStatus,
  type MailRun,
  type PrismaClient
} from "@prisma/client";
import { assertValidReportDate } from "../report-worker/date.utils";
import { buildReportMailContent } from "./report-mail-content";
import { classifyReportFileName, type ReportClassification } from "./report-file-classifier";
import { MailRunsRepository } from "./mail-runs.repository";
import { ReportEmailDeliveriesRepository } from "./report-email-deliveries.repository";
import { ReportFilesRepository, type StoredReportFile } from "./report-files.repository";
import { resolveReportRecipients } from "./resolve-report-recipients";
import type { MailProvider } from "./smtp.provider";

export interface MailLogger {
  info(payload: unknown, msg?: string): void;
  warn(payload: unknown, msg?: string): void;
  error(payload: unknown, msg?: string): void;
}

export interface ReportMailServiceInput {
  prisma: PrismaClient;
  logger: MailLogger;
  mailProvider: MailProvider;
  adminEmails: string[];
  maxAttempts: number;
  retryDelayMs: number;
  reportsBaseDir: string;
}

interface ProcessRunSummary {
  runId: bigint;
  reportDate: string;
  totalDeliveries: number;
  sentCount: number;
  failedCount: number;
  notSendableCount: number;
}

function toDateOnly(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function fromDateOnly(value: Date) {
  return value.toISOString().slice(0, 10);
}

function toErrorText(error: unknown) {
  if (error instanceof Error) {
    return error.stack || error.message;
  }
  return String(error);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toReportDate(input: Date | string) {
  if (input instanceof Date) {
    return fromDateOnly(input);
  }
  return input;
}

export class ReportMailService {
  private readonly filesRepository: ReportFilesRepository;
  private readonly deliveriesRepository: ReportEmailDeliveriesRepository;
  private readonly mailRunsRepository: MailRunsRepository;

  constructor(private readonly input: ReportMailServiceInput) {
    this.filesRepository = new ReportFilesRepository(input.prisma);
    this.deliveriesRepository = new ReportEmailDeliveriesRepository(input.prisma);
    this.mailRunsRepository = new MailRunsRepository(input.prisma);
  }

  private async ensureFileReady(filePathRaw: string) {
    const baseDir = path.resolve(this.input.reportsBaseDir);
    const absolutePath = path.resolve(filePathRaw);
    const relative = path.relative(baseDir, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`File path is outside REPORTS_BASE_DIR: ${absolutePath}`);
    }

    await fs.access(absolutePath);
    return absolutePath;
  }

  private async prepareOneReport(input: {
    report: StoredReportFile;
    targetReportDate: string;
    force: boolean;
  }) {
    const reportDate = input.targetReportDate;
    const rawFileName = input.report.fileName;
    const classification = classifyReportFileName(rawFileName);

    if (!classification) {
      await this.deliveriesRepository.markRecipientResolutionFailed({
        reportDate,
        reportType: input.report.reportCode,
        fileName: rawFileName,
        filePath: input.report.filePath,
        recipientType: "admin",
        recipientKey: `system:unclassified:${rawFileName}`,
        organizationId: input.report.organizationId,
        errorMessage: `Cannot classify report file by name: ${rawFileName}`,
        force: input.force
      });

      this.input.logger.warn(
        {
          event: "report_classified",
          fileName: rawFileName,
          reportDate,
          status: "failed"
        },
        "Report file classification failed"
      );
      return {
        prepared: 0,
        failures: 1
      };
    }

    this.input.logger.info(
      {
        event: "report_classified",
        fileName: rawFileName,
        reportType: classification.reportType,
        kind: classification.kind,
        organizationId: classification.organizationId?.toString() ?? null
      },
      "Report file classified"
    );

    if (classification.reportDate !== reportDate) {
      await this.deliveriesRepository.markRecipientResolutionFailed({
        reportDate,
        reportType: classification.reportType,
        fileName: rawFileName,
        filePath: input.report.filePath,
        recipientType: classification.kind === "admin" ? "admin" : "organization",
        recipientKey: `system:date-mismatch:${rawFileName}`,
        organizationId: classification.organizationId,
        errorMessage: `Report date mismatch in file name ${rawFileName}: ${classification.reportDate}`,
        force: input.force
      });

      return {
        prepared: 0,
        failures: 1
      };
    }

    let filePath = input.report.filePath;
    try {
      filePath = await this.ensureFileReady(input.report.filePath);
    } catch (error) {
      await this.deliveriesRepository.markRecipientResolutionFailed({
        reportDate,
        reportType: classification.reportType,
        fileName: rawFileName,
        filePath: input.report.filePath,
        recipientType: classification.kind === "admin" ? "admin" : "organization",
        recipientKey: `system:file-missing:${rawFileName}`,
        organizationId: classification.organizationId,
        errorMessage: `Report file is missing: ${toErrorText(error)}`,
        force: input.force
      });
      return {
        prepared: 0,
        failures: 1
      };
    }

    const recipients = await resolveReportRecipients(classification, {
      adminEmails: this.input.adminEmails,
      findOrganizationById: async (id) => {
        const organization = await this.input.prisma.organization.findUnique({
          where: {
            id
          },
          select: {
            id: true,
            name: true,
            email: true
          }
        });
        if (!organization) {
          return null;
        }

        return {
          id: organization.id,
          name: organization.name,
          email: organization.email
        };
      }
    });

    if (!recipients.ok) {
      await this.deliveriesRepository.markRecipientResolutionFailed({
        reportDate,
        reportType: classification.reportType,
        fileName: rawFileName,
        filePath,
        recipientType: recipients.recipientType,
        recipientKey: recipients.recipientKey,
        organizationId: recipients.organizationId,
        errorMessage: recipients.errorMessage,
        force: input.force
      });
      this.input.logger.warn(
        {
          event: "email_send_failed",
          reportDate,
          fileName: rawFileName,
          error: recipients.errorMessage
        },
        "Failed to resolve recipients"
      );
      return {
        prepared: 0,
        failures: 1
      };
    }

    for (const recipient of recipients.recipients) {
      await this.deliveriesRepository.ensureDelivery({
        reportDate,
        reportType: classification.reportType,
        fileName: rawFileName,
        filePath,
        recipient: {
          recipientType: recipient.recipientType,
          recipientEmail: recipient.recipientEmail,
          recipientKey: recipient.recipientKey,
          organizationId: recipient.organizationId
        },
        force: input.force
      });
    }

    return {
      prepared: recipients.recipients.length,
      failures: 0
    };
  }

  private async prepareDeliveriesForDate(input: {
    reportDate: string;
    force: boolean;
    fileName?: string;
  }) {
    const reports = await this.filesRepository.listSuccessfulByDate(input.reportDate);
    const filteredReports = input.fileName
      ? reports.filter((item) => item.fileName === input.fileName)
      : reports;

    this.input.logger.info(
      {
        event: "reports_found",
        reportDate: input.reportDate,
        reportsCount: filteredReports.length
      },
      "Reports discovered for mailing"
    );

    let prepared = 0;
    let failures = 0;
    for (const report of filteredReports) {
      const result = await this.prepareOneReport({
        report,
        targetReportDate: input.reportDate,
        force: input.force
      });
      prepared += result.prepared;
      failures += result.failures;
    }

    return {
      reportsCount: filteredReports.length,
      preparedDeliveries: prepared,
      preparationFailures: failures
    };
  }

  private buildMailContent(input: {
    delivery: {
      reportType: string;
      reportDate: Date;
      orgId: bigint | null;
      fileName: string;
      filePath: string;
      recipientEmail: string | null;
    };
  }) {
    const reportDate = fromDateOnly(input.delivery.reportDate);
    if (input.delivery.orgId) {
      return this.input.prisma.organization
        .findUnique({
          where: {
            id: input.delivery.orgId
          },
          select: {
            name: true
          }
        })
        .then((organization) =>
          buildReportMailContent({
            reportType: input.delivery.reportType,
            reportDate,
            organizationName: organization?.name ?? null
          })
        );
    }

    return Promise.resolve(
      buildReportMailContent({
        reportType: input.delivery.reportType,
        reportDate
      })
    );
  }

  private async sendDeliveryWithRetry(input: {
    runId: bigint;
    deliveryId: bigint;
    force: boolean;
  }) {
    const delivery = await this.deliveriesRepository.findById(input.deliveryId);
    if (!delivery || !delivery.recipientEmail) {
      return false;
    }

    const baseAttempts = this.input.maxAttempts;
    const attemptsLimit = input.force ? baseAttempts : Math.max(0, baseAttempts - delivery.attemptsCount);
    if (attemptsLimit <= 0) {
      return false;
    }

    for (let attemptIndex = 0; attemptIndex < attemptsLimit; attemptIndex += 1) {
      if (attemptIndex > 0) {
        const delayMs = this.input.retryDelayMs * 2 ** (attemptIndex - 1);
        await sleep(delayMs);
      }

      const claimed = await this.deliveriesRepository.claimForProcessing(delivery.id, input.force);
      if (!claimed) {
        return false;
      }

      const mailContent = await this.buildMailContent({
        delivery
      });

      this.input.logger.info(
        {
          event: "email_send_started",
          runId: input.runId.toString(),
          deliveryId: delivery.id.toString(),
          recipient: delivery.recipientEmail,
          fileName: delivery.fileName,
          attempt: attemptIndex + 1
        },
        "Sending report email"
      );

      try {
        await this.input.mailProvider.sendEmail({
          to: delivery.recipientEmail,
          subject: mailContent.subject,
          text: mailContent.text,
          attachmentPath: delivery.filePath,
          attachmentName: delivery.fileName
        });

        await this.deliveriesRepository.markSent({
          deliveryId: delivery.id,
          mailRunId: input.runId,
          forced: input.force
        });

        this.input.logger.info(
          {
            event: "email_send_success",
            runId: input.runId.toString(),
            deliveryId: delivery.id.toString(),
            recipient: delivery.recipientEmail,
            fileName: delivery.fileName
          },
          "Report email sent"
        );

        return true;
      } catch (error) {
        await this.deliveriesRepository.markFailed({
          deliveryId: delivery.id,
          mailRunId: input.runId,
          forced: input.force,
          error
        });

        this.input.logger.error(
          {
            event: "email_send_failed",
            runId: input.runId.toString(),
            deliveryId: delivery.id.toString(),
            recipient: delivery.recipientEmail,
            fileName: delivery.fileName,
            attempt: attemptIndex + 1,
            err: error
          },
          "Report email send failed"
        );
      }
    }

    return false;
  }

  private async processRunRow(run: MailRun): Promise<ProcessRunSummary> {
    const reportDate = fromDateOnly(run.reportDate);
    this.input.logger.info(
      {
        event: "mail_worker_started",
        runId: run.id.toString(),
        reportDate,
        force: run.force,
        trigger: run.trigger
      },
      "Mail run started"
    );

    const prepared = await this.prepareDeliveriesForDate({
      reportDate,
      force: run.force
    });

    const deliveries = await this.deliveriesRepository.listForProcessing({
      reportDate,
      force: run.force,
      maxAttempts: this.input.maxAttempts
    });

    let sentCount = 0;
    let failedCount = 0;
    for (const delivery of deliveries) {
      const sent = await this.sendDeliveryWithRetry({
        runId: run.id,
        deliveryId: delivery.id,
        force: run.force
      });
      if (sent) {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    }

    const notSendableCount = prepared.preparationFailures;
    const totalDeliveries = deliveries.length + notSendableCount;

    if (failedCount > 0 || notSendableCount > 0) {
      await this.mailRunsRepository.markFailed({
        runId: run.id,
        totalDeliveries,
        sentCount,
        failedCount: failedCount + notSendableCount,
        errorText: `failed_deliveries=${failedCount}, not_sendable=${notSendableCount}`
      });
    } else {
      await this.mailRunsRepository.markCompleted({
        runId: run.id,
        totalDeliveries,
        sentCount,
        failedCount: 0
      });
    }

    this.input.logger.info(
      {
        event: "mail_worker_finished",
        runId: run.id.toString(),
        reportDate,
        totalDeliveries,
        sentCount,
        failedCount,
        notSendableCount
      },
      "Mail run finished"
    );

    return {
      runId: run.id,
      reportDate,
      totalDeliveries,
      sentCount,
      failedCount,
      notSendableCount
    };
  }

  async enqueueRun(input: {
    reportDate: string;
    force?: boolean;
    trigger: string;
    requestedBy?: string | null;
    deduplicateOpenRun?: boolean;
  }) {
    assertValidReportDate(input.reportDate);
    const force = input.force ?? false;

    if (!force && input.deduplicateOpenRun) {
      const openRun = await this.mailRunsRepository.findOpenRunByDate(input.reportDate);
      if (openRun) {
        return {
          run: openRun,
          deduplicated: true
        };
      }
    }

    const run = await this.mailRunsRepository.createRun({
      reportDate: input.reportDate,
      trigger: input.trigger,
      force,
      requestedBy: input.requestedBy ?? null
    });

    return {
      run,
      deduplicated: false
    };
  }

  async processNextPendingRun() {
    const run = await this.mailRunsRepository.claimNextPendingRun();
    if (!run) {
      return null;
    }

    try {
      return await this.processRunRow(run);
    } catch (error) {
      await this.mailRunsRepository.markFailed({
        runId: run.id,
        totalDeliveries: 0,
        sentCount: 0,
        failedCount: 0,
        errorText: toErrorText(error)
      });
      throw error;
    }
  }

  async processRunById(runId: bigint) {
    const run = await this.mailRunsRepository.claimById(runId);
    if (!run) {
      const current = await this.mailRunsRepository.findById(runId);
      if (!current) {
        throw new Error(`Mail run not found: ${runId.toString()}`);
      }
      if (current.status === MailRunStatus.COMPLETED || current.status === MailRunStatus.FAILED) {
        return {
          runId: current.id,
          reportDate: fromDateOnly(current.reportDate),
          totalDeliveries: current.totalDeliveries,
          sentCount: current.sentCount,
          failedCount: current.failedCount,
          notSendableCount: 0
        } satisfies ProcessRunSummary;
      }

      throw new Error(`Mail run is already in progress: ${runId.toString()}`);
    }

    return this.processRunRow(run);
  }

  async runForDateNow(input: {
    reportDate: string;
    force?: boolean;
    trigger: string;
    requestedBy?: string | null;
    deduplicateOpenRun?: boolean;
  }) {
    const queued = await this.enqueueRun(input);
    if (queued.deduplicated && queued.run.status === MailRunStatus.PROCESSING) {
      return {
        run: queued.run,
        deduplicated: queued.deduplicated,
        summary: {
          runId: queued.run.id,
          reportDate: fromDateOnly(queued.run.reportDate),
          totalDeliveries: queued.run.totalDeliveries,
          sentCount: queued.run.sentCount,
          failedCount: queued.run.failedCount,
          notSendableCount: 0
        } satisfies ProcessRunSummary
      };
    }

    const summary = await this.processRunById(queued.run.id);
    return {
      run: queued.run,
      deduplicated: queued.deduplicated,
      summary
    };
  }

  async sendOne(input: {
    reportDate?: string;
    fileName?: string;
    filePath?: string;
    deliveryId?: bigint;
    force?: boolean;
    requestedBy?: string | null;
  }) {
    const force = input.force ?? false;
    if (input.deliveryId) {
      const existing = await this.deliveriesRepository.findById(input.deliveryId);
      if (!existing) {
        throw new Error(`Delivery not found: ${input.deliveryId.toString()}`);
      }

      const reportDate = fromDateOnly(existing.reportDate);
      const queued = await this.enqueueRun({
        reportDate,
        force,
        trigger: "manual-api-send-one",
        requestedBy: input.requestedBy ?? null,
        deduplicateOpenRun: false
      });

      const list = await this.deliveriesRepository.listForProcessing({
        reportDate,
        force,
        maxAttempts: this.input.maxAttempts,
        deliveryId: input.deliveryId
      });

      let sentCount = 0;
      let failedCount = 0;
      for (const delivery of list) {
        const sent = await this.sendDeliveryWithRetry({
          runId: queued.run.id,
          deliveryId: delivery.id,
          force
        });
        if (sent) {
          sentCount += 1;
        } else {
          failedCount += 1;
        }
      }

      await this.mailRunsRepository.markCompleted({
        runId: queued.run.id,
        totalDeliveries: list.length,
        sentCount,
        failedCount
      });

      return {
        runId: queued.run.id,
        reportDate,
        totalDeliveries: list.length,
        sentCount,
        failedCount
      };
    }

    let reportDate = input.reportDate;
    let fileName = input.fileName;
    if (!fileName && input.filePath) {
      const foundByPath = await this.filesRepository.findSuccessfulByFilePath(input.filePath);
      if (!foundByPath) {
        throw new Error(`Generated report not found by filePath: ${input.filePath}`);
      }
      reportDate = foundByPath.reportDate;
      fileName = foundByPath.fileName;
    }

    if (!fileName && !input.filePath) {
      throw new Error("send-one requires one of: deliveryId, fileName, filePath");
    }

    if (!reportDate && fileName) {
      const foundByName = await this.filesRepository.findSuccessfulByFileName(fileName);
      if (!foundByName) {
        throw new Error(`Generated report not found by fileName: ${fileName}`);
      }
      reportDate = foundByName.reportDate;
    }

    if (!reportDate || !fileName) {
      throw new Error("Failed to resolve reportDate and fileName for send-one");
    }

    assertValidReportDate(reportDate);

    const queued = await this.enqueueRun({
      reportDate,
      force,
      trigger: "manual-api-send-one",
      requestedBy: input.requestedBy ?? null,
      deduplicateOpenRun: false
    });

    await this.prepareDeliveriesForDate({
      reportDate,
      force,
      fileName
    });

    const list = await this.deliveriesRepository.listForProcessing({
      reportDate,
      force,
      maxAttempts: this.input.maxAttempts,
      fileName
    });

    let sentCount = 0;
    let failedCount = 0;
    for (const delivery of list) {
      const sent = await this.sendDeliveryWithRetry({
        runId: queued.run.id,
        deliveryId: delivery.id,
        force
      });
      if (sent) {
        sentCount += 1;
      } else {
        failedCount += 1;
      }
    }

    if (failedCount > 0) {
      await this.mailRunsRepository.markFailed({
        runId: queued.run.id,
        totalDeliveries: list.length,
        sentCount,
        failedCount,
        errorText: `send_one_failed=${failedCount}`
      });
    } else {
      await this.mailRunsRepository.markCompleted({
        runId: queued.run.id,
        totalDeliveries: list.length,
        sentCount,
        failedCount: 0
      });
    }

    return {
      runId: queued.run.id,
      reportDate,
      fileName,
      totalDeliveries: list.length,
      sentCount,
      failedCount
    };
  }

  async getStatus(input: {
    reportDate: string;
    status?: ReportEmailDeliveryStatus;
    organizationId?: bigint;
    fileName?: string;
  }) {
    assertValidReportDate(input.reportDate);
    const [runs, deliveries] = await Promise.all([
      this.mailRunsRepository.listByDate(input.reportDate),
      this.deliveriesRepository.listByDate({
        reportDate: input.reportDate,
        status: input.status,
        organizationId: input.organizationId,
        fileName: input.fileName
      })
    ]);

    return {
      reportDate: input.reportDate,
      runs,
      deliveries
    };
  }

  async ensureSmtpConnection() {
    await this.input.mailProvider.verify();
  }

  async getMailRunById(runId: bigint) {
    return this.mailRunsRepository.findById(runId);
  }

  async listPendingDeliveries(reportDate: string) {
    return this.input.prisma.reportEmailDelivery.findMany({
      where: {
        reportDate: toDateOnly(reportDate),
        status: {
          in: [ReportEmailDeliveryStatus.PENDING, ReportEmailDeliveryStatus.FAILED]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }]
    });
  }
}
