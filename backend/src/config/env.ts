import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
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
  PUBLIC_FILES_BASE_URL: z.string().url().default("http://localhost:3000/uploads")
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  throw new Error(`Invalid environment variables:\n${details.join("\n")}`);
}

export const env = parsedEnv.data;
export const isProduction = env.NODE_ENV === "production";
