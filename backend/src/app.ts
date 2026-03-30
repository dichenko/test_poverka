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

function getAllowedOrigins() {
  return env.CORS_ORIGINS.split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

  app.use("/public/reports", express.static(path.resolve(env.REPORTS_STORAGE_DIR)));
  app.use("/static", express.static(path.resolve(env.STORAGE_LOCAL_PATH)));
  app.use("/uploads", express.static(path.resolve(env.STORAGE_LOCAL_PATH)));
  app.use(healthRoutes);
  app.use("/api", authRoutes);
  app.use("/api", submissionsRoutes);
  app.use("/api", storageRoutes);
  app.use("/api", adminRoutes);
  app.use(paymentsRoutes);
  app.use(botRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
