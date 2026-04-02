import "server-only";
import { existsSync } from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  ADMIN_PANEL_PUBLIC_URL: z.string().url("ADMIN_PANEL_PUBLIC_URL must be a valid URL"),
  ADMIN_AUTH_LOGIN: z.string().min(1, "ADMIN_AUTH_LOGIN is required"),
  ADMIN_AUTH_PASSWORD: z.string().min(1, "ADMIN_AUTH_PASSWORD is required"),
  ADMIN_SESSION_SECRET: z.string().min(16, "ADMIN_SESSION_SECRET must be at least 16 characters"),
  ADMIN_SESSION_DURATION_DAYS: z.coerce.number().int().positive().default(30)
});

type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;
let envLoaded = false;

function loadEnvironmentFiles() {
  if (envLoaded) {
    return;
  }

  const cwd = process.cwd();
  const rootLocalEnv = path.resolve(cwd, "../.env.local");
  const rootEnv = path.resolve(cwd, "../.env");
  const hasRootEnv = existsSync(rootLocalEnv) || existsSync(rootEnv);

  if (hasRootEnv) {
    loadDotenv({ path: rootLocalEnv });
    loadDotenv({ path: rootEnv });
  } else {
    loadDotenv({ path: path.resolve(cwd, ".env.local") });
    loadDotenv({ path: path.resolve(cwd, ".env") });
  }

  envLoaded = true;
}

export function getEnv(): Env {
  if (cachedEnv) {
    return cachedEnv;
  }

  loadEnvironmentFiles();

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
    throw new Error(`Invalid admin-panel environment: ${message}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
