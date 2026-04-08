import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import path from "path";
import pinoHttp from "pino-http";
import { logger } from "./common/logger";
import { env } from "./config/env";
import { authRoutes } from "./modules/auth/auth.routes";
import { botRoutes } from "./modules/bot/bot.routes";
import { healthRoutes } from "./modules/health/health.routes";
import { storageRoutes } from "./modules/storage/storage.routes";
import { submissionsRoutes } from "./modules/submissions/submissions.routes";
import { defaultRateLimit } from "./middlewares/rate-limit";
import { notFoundHandler, errorHandler } from "./middlewares/error-handler";
import { adminRoutes } from "./modules/admin/admin.routes";
import { paymentsRoutes } from "./modules/payments/payments.routes";
import { reportMailRoutes } from "./modules/report-mail/report-mail.routes";
import { reportPublicRoutes } from "./modules/report-public/report-public.routes";
import {
  extractPathnameFromPublicBaseUrl,
  normalizePublicRoutePath
} from "./report-worker/report-public-url";

function getAllowedOrigins() {
  return env.CORS_ORIGINS.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getReportPublicRoutePaths() {
  const paths = new Set<string>();

  const reportsBasePath = normalizePublicRoutePath(extractPathnameFromPublicBaseUrl(env.REPORTS_PUBLIC_BASE_URL));
  if (reportsBasePath !== "/") {
    paths.add(reportsBasePath);
  }

  const uploadsReportsPath = normalizePublicRoutePath(
    `${extractPathnameFromPublicBaseUrl(env.PUBLIC_FILES_BASE_URL).replace(/\/+$/, "")}/reports`
  );
  if (uploadsReportsPath !== "/") {
    paths.add(uploadsReportsPath);
  }

  paths.add("/public/reports");
  paths.add("/uploads/reports");

  return Array.from(paths);
}

function denyDirectReportsAccess(req: express.Request, res: express.Response, next: express.NextFunction) {
  const normalizedPath = req.path.replace(/\\/g, "/");
  if (normalizedPath === "/reports" || normalizedPath.startsWith("/reports/")) {
    return res.status(404).end();
  }
  return next();
}

export function createApp() {
  const app = express();
  const allowedOrigins = getAllowedOrigins();

  app.set("trust proxy", 1);
  app.use(
    pinoHttp({
      logger
    })
  );
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("CORS origin is not allowed."));
      },
      credentials: true
    })
  );
  app.use(
    express.json({
      limit: "1mb",
      verify(req, _res, buffer) {
        (req as any).rawBody = Buffer.from(buffer);
      }
    })
  );
  app.use(cookieParser());
  app.use(defaultRateLimit);

  for (const routePath of getReportPublicRoutePaths()) {
    app.use(routePath, reportPublicRoutes);
  }

  app.use("/static", denyDirectReportsAccess, express.static(path.resolve(env.STORAGE_LOCAL_PATH)));
  app.use("/uploads", denyDirectReportsAccess, express.static(path.resolve(env.STORAGE_LOCAL_PATH)));
  app.use(healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", submissionsRoutes);
  app.use("/api", storageRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", reportMailRoutes);
  app.use(paymentsRoutes);
  app.use(botRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
