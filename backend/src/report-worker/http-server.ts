import type { Server } from "http";
import express from "express";
import { z } from "zod";
import { resolveReportDate } from "./date.utils";
import type { ReportLogger } from "./report.types";
import type { ReportsRunner } from "./reports-runner";

const runReportBodySchema = z.object({
  reportCode: z.string().trim().min(1).optional(),
  date: z.string().trim().optional()
});

interface StartHttpServerInput {
  port: number;
  internalApiToken: string;
  reportsTimeZone: string;
  runner: ReportsRunner;
  logger: ReportLogger;
}

function isAuthorizedRequest(requestToken: string | undefined, expectedToken: string) {
  return Boolean(requestToken && requestToken === expectedToken);
}

export function startReportWorkerHttpServer(input: StartHttpServerInput): Server {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health/live", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/internal/reports/run", async (req, res) => {
    const requestToken = req.header("X-Internal-Token")?.trim();

    if (!isAuthorizedRequest(requestToken, input.internalApiToken)) {
      return res.status(401).json({
        ok: false,
        error: "Unauthorized"
      });
    }

    let payload: z.infer<typeof runReportBodySchema>;
    try {
      payload = runReportBodySchema.parse(req.body ?? {});
    } catch (error) {
      input.logger.warn({ err: error }, "Invalid body for manual report run endpoint");
      return res.status(400).json({
        ok: false,
        error: "Invalid request body"
      });
    }

    try {
      const date = resolveReportDate(payload.date, input.reportsTimeZone);
      const result = await input.runner.run({
        date,
        reportCode: payload.reportCode,
        trigger: "manual-http"
      });

      if (!result.lockAcquired) {
        return res.status(409).json({
          ok: false,
          message: "Report generation is already running",
          result
        });
      }

      return res.json({
        ok: true,
        result
      });
    } catch (error) {
      input.logger.error({ err: error }, "Manual report run via HTTP failed");
      return res.status(500).json({
        ok: false,
        error: "Internal error"
      });
    }
  });

  return app.listen(input.port, () => {
    input.logger.info({ port: input.port }, "Report worker HTTP endpoint started");
  });
}

