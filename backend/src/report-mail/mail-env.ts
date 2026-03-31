import { z } from "zod";

const emailSchema = z.string().trim().email();

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return value;
}

function parseAdminEmails(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const schema = z.object({
  SMTP_HOST: z.string().trim().min(1).default("smtp.timeweb.ru"),
  SMTP_PORT: z.coerce.number().int().positive().default(465),
  SMTP_SECURE: z.preprocess(parseBoolean, z.boolean().default(true)),
  SMTP_USER: z.string().trim().min(1).default("replace_me"),
  SMTP_PASSWORD: z.string().min(1).default("replace_me"),
  SMTP_FROM: z.string().trim().min(1).default("reports@example.com"),
  REPORT_ADMIN_EMAILS: z.string().default(""),
  MAIL_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  MAIL_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),
  MAIL_WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
  MAIL_API_TOKEN: z.string().trim().min(1).default(process.env.INTERNAL_API_TOKEN ?? "change_me_mail_api_token"),
  REPORTS_BASE_DIR: z
    .string()
    .trim()
    .default(process.env.REPORTS_STORAGE_DIR?.trim() || "/app/storage/reports")
});

export type ParsedMailEnv = z.infer<typeof schema> & {
  REPORT_ADMIN_EMAILS_LIST: string[];
};

export function parseMailEnv(raw: NodeJS.ProcessEnv = process.env): ParsedMailEnv {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues.map((item) => `${item.path.join(".")}: ${item.message}`);
    throw new Error(`Invalid mail environment variables:\n${details.join("\n")}`);
  }

  const adminEmails = parseAdminEmails(parsed.data.REPORT_ADMIN_EMAILS);
  const invalid = adminEmails.filter((item) => !emailSchema.safeParse(item).success);
  if (invalid.length) {
    throw new Error(`Invalid REPORT_ADMIN_EMAILS values: ${invalid.join(", ")}`);
  }

  return {
    ...parsed.data,
    REPORT_ADMIN_EMAILS_LIST: adminEmails
  };
}
