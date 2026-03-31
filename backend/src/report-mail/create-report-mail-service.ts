import type { PrismaClient } from "@prisma/client";
import type { MailLogger } from "./report-mail.service";
import { parseMailEnv } from "./mail-env";
import { ReportMailService } from "./report-mail.service";
import { SmtpMailProvider } from "./smtp.provider";

export function createReportMailService(input: { prisma: PrismaClient; logger: MailLogger }) {
  const mailEnv = parseMailEnv(process.env);
  const provider = new SmtpMailProvider({
    host: mailEnv.SMTP_HOST,
    port: mailEnv.SMTP_PORT,
    secure: mailEnv.SMTP_SECURE,
    user: mailEnv.SMTP_USER,
    password: mailEnv.SMTP_PASSWORD,
    from: mailEnv.SMTP_FROM
  });

  const service = new ReportMailService({
    prisma: input.prisma,
    logger: input.logger,
    mailProvider: provider,
    adminEmails: mailEnv.REPORT_ADMIN_EMAILS_LIST,
    maxAttempts: mailEnv.MAIL_MAX_ATTEMPTS,
    retryDelayMs: mailEnv.MAIL_RETRY_DELAY_MS,
    reportsBaseDir: mailEnv.REPORTS_BASE_DIR
  });

  return {
    service,
    mailEnv
  };
}
