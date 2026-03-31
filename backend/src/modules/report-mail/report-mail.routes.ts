import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { prisma } from "../../common/prisma";
import { createReportMailService } from "../../report-mail/create-report-mail-service";
import { validate } from "../../common/validate";
import {
  reportMailRunBodySchema,
  reportMailSendOneBodySchema,
  reportMailStatusQuerySchema
} from "./report-mail.schemas";
import { env } from "../../config/env";
import { logger } from "../../common/logger";

const router = Router();
const { service } = createReportMailService({
  prisma,
  logger
});

function requireMailApiToken(req: Request, res: Response, next: NextFunction) {
  const requestToken = req.header("X-Mail-Api-Token")?.trim();
  if (!requestToken || requestToken !== env.MAIL_API_TOKEN) {
    return res.status(401).json({
      ok: false,
      error: {
        code: "MAIL_API_UNAUTHORIZED",
        message: "Unauthorized"
      }
    });
  }
  return next();
}

function serializeMailRun(run: {
  id: bigint;
  reportDate: Date;
  trigger: string;
  force: boolean;
  requestedBy: string | null;
  status: string;
  totalDeliveries: number;
  sentCount: number;
  failedCount: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  errorText: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: run.id.toString(),
    reportDate: run.reportDate.toISOString().slice(0, 10),
    trigger: run.trigger,
    force: run.force,
    requestedBy: run.requestedBy,
    status: run.status,
    totalDeliveries: run.totalDeliveries,
    sentCount: run.sentCount,
    failedCount: run.failedCount,
    startedAt: run.startedAt?.toISOString() ?? null,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    errorText: run.errorText,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString()
  };
}

function serializeDelivery(delivery: {
  id: bigint;
  reportDate: Date;
  reportType: string;
  fileName: string;
  filePath: string;
  orgId: bigint | null;
  recipientEmail: string | null;
  recipientKey: string;
  recipientType: string;
  status: string;
  attemptsCount: number;
  lastError: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: delivery.id.toString(),
    reportDate: delivery.reportDate.toISOString().slice(0, 10),
    reportType: delivery.reportType,
    fileName: delivery.fileName,
    filePath: delivery.filePath,
    orgId: delivery.orgId?.toString() ?? null,
    recipientEmail: delivery.recipientEmail,
    recipientKey: delivery.recipientKey,
    recipientType: delivery.recipientType.toLowerCase(),
    status: delivery.status.toLowerCase(),
    attemptsCount: delivery.attemptsCount,
    lastError: delivery.lastError,
    sentAt: delivery.sentAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    updatedAt: delivery.updatedAt.toISOString()
  };
}

router.use("/reports/mail", requireMailApiToken);

router.post("/reports/mail/run", validate(reportMailRunBodySchema), async (req, res, next) => {
  try {
    const body = reportMailRunBodySchema.parse(req.body);
    const result = await service.runForDateNow({
      reportDate: body.date,
      force: body.force,
      trigger: "manual-api-run",
      requestedBy: "mail-api",
      deduplicateOpenRun: !body.force
    });

    const run = await service.getMailRunById(result.run.id);

    return res.json({
      ok: true,
      runId: result.run.id.toString(),
      deduplicated: result.deduplicated,
      summary: {
        ...result.summary,
        runId: result.summary.runId.toString()
      },
      run: run ? serializeMailRun(run) : null
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/reports/mail/send-one", validate(reportMailSendOneBodySchema), async (req, res, next) => {
  try {
    const body = reportMailSendOneBodySchema.parse(req.body);
    const result = await service.sendOne({
      reportDate: body.date,
      fileName: body.fileName,
      filePath: body.filePath,
      deliveryId: body.deliveryId,
      force: body.force,
      requestedBy: "mail-api"
    });

    return res.json({
      ok: true,
      result: {
        ...result,
        runId: result.runId.toString()
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/reports/mail/status", validate(reportMailStatusQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = reportMailStatusQuerySchema.parse(req.query);
    const status = await service.getStatus({
      reportDate: query.date,
      status: query.status,
      organizationId: query.orgId,
      fileName: query.fileName
    });

    return res.json({
      ok: true,
      reportDate: status.reportDate,
      runs: status.runs.map((run) => serializeMailRun(run)),
      deliveries: status.deliveries.map((delivery) => serializeDelivery(delivery))
    });
  } catch (error) {
    return next(error);
  }
});

export { router as reportMailRoutes };
