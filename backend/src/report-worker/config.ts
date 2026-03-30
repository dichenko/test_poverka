import "dotenv/config";
import { z } from "zod";
import { isValidTimeZone } from "./date.utils";

const defaultReportsPublicBaseUrl = (() => {
  const explicit = process.env.REPORTS_PUBLIC_BASE_URL?.trim();
  if (explicit) {
    return explicit;
  }

  const filesBase = process.env.PUBLIC_FILES_BASE_URL?.trim();
  if (filesBase) {
    return `${filesBase.replace(/\/$/, "")}/reports`;
  }

  const backendBase = process.env.BACKEND_PUBLIC_URL?.trim();
  if (backendBase) {
    return `${backendBase.replace(/\/$/, "")}/public/reports`;
  }

  return "http://localhost:3000/uploads/reports";
})();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  REPORTS_STORAGE_DIR: z.string().default("/app/storage/reports"),
  REPORTS_PUBLIC_BASE_URL: z.preprocess(
    (value) => {
      if (typeof value !== "string") {
        return value;
      }
      const trimmed = value.trim();
      return trimmed.length ? trimmed : undefined;
    },
    z.string().url().default(defaultReportsPublicBaseUrl)
  ),
  REPORTS_CRON: z.string().min(1).default("5 22 * * *"),
  REPORTS_TZ: z.string().min(1).default("Europe/Moscow"),
  REPORTS_HTTP_PORT: z.coerce.number().int().positive().default(3010),
  REPORTS_LOCK_ID: z.coerce.bigint().default(7342052205n),
  INTERNAL_API_TOKEN: z.string().min(1).default("change_me_internal_token")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid report-worker environment variables:\n${details.join("\n")}`);
}

if (!isValidTimeZone(parsedEnv.data.REPORTS_TZ)) {
  throw new Error(`Invalid REPORTS_TZ value: "${parsedEnv.data.REPORTS_TZ}".`);
}

export const reportEnv = parsedEnv.data;
