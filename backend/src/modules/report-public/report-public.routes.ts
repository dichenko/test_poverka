import path from "path";
import { Router } from "express";
import { GeneratedReportStatus } from "@prisma/client";
import { prisma } from "../../common/prisma";
import { env } from "../../config/env";
import { logger } from "../../common/logger";
import { isValidReportPublicToken } from "../../report-worker/report-public-url";

function ensurePathInside(baseDir: string, targetPath: string) {
  const absoluteBase = path.resolve(baseDir);
  const absoluteTarget = path.resolve(targetPath);
  const relative = path.relative(absoluteBase, absoluteTarget);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside base dir: ${absoluteTarget}`);
  }
  return absoluteTarget;
}

const router = Router();

router.get("/:token", async (req, res) => {
  const tokenRaw = String(req.params.token ?? "").trim();
  if (!isValidReportPublicToken(tokenRaw)) {
    return res.status(404).end();
  }

  try {
    const report = await prisma.generatedReport.findFirst({
      where: {
        publicToken: tokenRaw,
        status: GeneratedReportStatus.SUCCESS
      },
      orderBy: {
        finishedAt: "desc"
      },
      select: {
        filePath: true,
        fileName: true
      }
    });

    if (!report) {
      return res.status(404).end();
    }

    const safePath = ensurePathInside(env.REPORTS_STORAGE_DIR, report.filePath);

    return res.download(safePath, report.fileName, (error) => {
      if (!error) {
        return;
      }

      if (!res.headersSent) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          res.status(404).end();
          return;
        }
        res.status(500).end();
      }

      logger.error(
        {
          err: error,
          token: tokenRaw
        },
        "Failed to serve report by public token"
      );
    });
  } catch (error) {
    logger.error(
      {
        err: error,
        token: tokenRaw
      },
      "Failed to resolve report by public token"
    );
    return res.status(404).end();
  }
});

export { router as reportPublicRoutes };
