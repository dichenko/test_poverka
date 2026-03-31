import "dotenv/config";
import { z } from "zod";

const defaultYookassaTimeoutMs = Number(
  process.env.YOOKASSA_HTTP_TIMEOUT_MS ?? process.env.YOOKASSA_REQUEST_TIMEOUT_MS ?? 10000
);
const defaultYookassaWebhookAllowedIps =
  process.env.YOOKASSA_WEBHOOK_ALLOWED_IPS ?? process.env.YOOKASSA_WEBHOOK_IP_ALLOWLIST ?? "127.0.0.1,::1";
const defaultTopupTtlSeconds = Number(process.env.TOPUP_LINK_TTL_SECONDS ?? process.env.PAYMENT_INVOICE_TTL_SECONDS ?? 180);
const defaultYookassaApiBaseUrl = process.env.YOOKASSA_API_BASE_URL ?? "https://api.yookassa.ru/v3";
const defaultReportsPublicBaseUrl = (() => {
  if (process.env.REPORTS_PUBLIC_BASE_URL) {
    return process.env.REPORTS_PUBLIC_BASE_URL;
  }
  if (process.env.BACKEND_PUBLIC_URL) {
    return `${process.env.BACKEND_PUBLIC_URL.replace(/\/$/, "")}/public/reports`;
  }
  return "http://localhost:3000/public/reports";
})();

const envSchema = z.object({
  APP_TIMEZONE: z.string().default(process.env.APP_TIMEZONE || "Europe/Moscow"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  REFRESH_COOKIE_NAME: z.string().default("max_refresh_token"),
  AUTH_COOKIE_SECURE: z.coerce.boolean().default(false),
  MAX_BOT_TOKEN: z.string().min(1),
  MAX_WEBHOOK_SECRET: z.string().min(1),
  MAX_BOT_API_BASE_URL: z.string().url().default("https://botapi.max.ru"),
  YOOKASSA_API_BASE_URL: z.string().url().default(defaultYookassaApiBaseUrl),
  YOOKASSA_SHOP_ID: z.string().min(1),
  YOOKASSA_SECRET_KEY: z.string().min(1),
  YOOKASSA_CURRENCY: z.string().min(1).default("RUB"),
  YOOKASSA_RECEIPT_VAT_CODE: z.coerce.number().int().min(1).max(6).default(1),
  YOOKASSA_RETURN_URL: z.string().url(),
  YOOKASSA_WEBHOOK_URL: z.string().url().optional(),
  YOOKASSA_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(defaultYookassaTimeoutMs),
  YOOKASSA_WEBHOOK_ALLOWED_IPS: z.string().default(defaultYookassaWebhookAllowedIps),
  PAYMENT_MIN_PACKAGES_PER_TOPUP: z.coerce.number().int().positive().default(1),
  PAYMENT_MAX_PACKAGES_PER_TOPUP: z.coerce.number().int().positive().default(1000),
  TOPUP_LINK_TTL_SECONDS: z.coerce.number().int().positive().default(defaultTopupTtlSeconds),
  PAYMENT_POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(10),
  PAYMENT_POLL_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  PAYMENT_POLL_BACKOFF_BASE_SECONDS: z.coerce.number().int().positive().default(5),
  PAYMENT_POLL_BACKOFF_MAX_SECONDS: z.coerce.number().int().positive().default(120),
  MAX_WEB_APP: z.string().min(1).optional(),
  MINIAPP_PUBLIC_URL: z.string().url(),
  BACKEND_PUBLIC_URL: z.string().url(),
  MAX_INITDATA_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  INITDATA_REPLAY_TTL_SECONDS: z.coerce.number().int().positive().default(600),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(120),
  AUTH_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(20),
  STORAGE_PROVIDER: z.enum(["local"]).default("local"),
  STORAGE_LOCAL_PATH: z.string().default("./storage"),
  STORAGE_PUBLIC_BASE_URL: z.string().url().default("http://localhost:3000/static"),
  PHOTO_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  PHOTO_ORIGINAL_DIR: z.string().default("./storage/photos/original"),
  PHOTO_COMPRESSED_DIR: z.string().default("./storage/photos/compressed"),
  PUBLIC_FILES_BASE_URL: z.string().url().default("http://localhost:3000/uploads"),
  REPORTS_STORAGE_DIR: z.string().default("/app/storage/reports"),
  REPORTS_PUBLIC_BASE_URL: z.string().url().default(defaultReportsPublicBaseUrl),
  REPORTS_CRON: z.string().default("5 22 * * *"),
  REPORTS_TZ: z.string().default("Europe/Moscow"),
  REPORTS_HTTP_PORT: z.coerce.number().int().positive().default(3010),
  REPORTS_LOCK_ID: z.coerce.bigint().default(7342052205n),
  INTERNAL_API_TOKEN: z.string().min(1).default("change_me_internal_token"),
  REPORTS_BASE_DIR: z.string().default(process.env.REPORTS_STORAGE_DIR ?? "/app/storage/reports"),
  SMTP_HOST: z.string().trim().min(1).default("smtp.timeweb.ru"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.coerce.boolean().default(true),
  SMTP_USER: z.string().trim().min(1).default("replace_me"),
  SMTP_PASSWORD: z.string().min(1).default("replace_me"),
  SMTP_FROM: z.string().trim().min(1).default("reports@example.com"),
  REPORT_ADMIN_EMAILS: z.string().default(""),
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MAIL_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),
  MAIL_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  MAIL_API_TOKEN: z.string().min(1).default(process.env.INTERNAL_API_TOKEN ?? "change_me_mail_api_token")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment variables:\n${details.join("\n")}`);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === "production";
