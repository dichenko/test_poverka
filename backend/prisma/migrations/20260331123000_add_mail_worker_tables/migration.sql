CREATE TYPE "ReportRunStatus" AS ENUM ('SUCCESS', 'FAILED');
CREATE TYPE "MailRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "ReportRecipientType" AS ENUM ('ADMIN', 'ORGANIZATION');
CREATE TYPE "ReportEmailDeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED');

CREATE TABLE "report_runs" (
  "id" BIGSERIAL NOT NULL,
  "report_date" DATE NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" "ReportRunStatus" NOT NULL,
  "total_reports" INTEGER NOT NULL DEFAULT 0,
  "successful_reports" INTEGER NOT NULL DEFAULT 0,
  "failed_reports" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "error_text" TEXT,
  "auto_mail_run_enqueued" BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "report_runs_report_date_key" ON "report_runs" ("report_date");
CREATE INDEX "report_runs_status_report_date_idx" ON "report_runs" ("status", "report_date" DESC);

CREATE TABLE "mail_runs" (
  "id" BIGSERIAL NOT NULL,
  "report_date" DATE NOT NULL,
  "trigger" TEXT NOT NULL,
  "force" BOOLEAN NOT NULL DEFAULT FALSE,
  "requested_by" TEXT,
  "status" "MailRunStatus" NOT NULL DEFAULT 'PENDING',
  "total_deliveries" INTEGER NOT NULL DEFAULT 0,
  "sent_count" INTEGER NOT NULL DEFAULT 0,
  "failed_count" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "error_text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "mail_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mail_runs_status_created_at_idx" ON "mail_runs" ("status", "created_at" ASC);
CREATE INDEX "mail_runs_report_date_created_at_idx" ON "mail_runs" ("report_date", "created_at" DESC);

CREATE TABLE "report_email_deliveries" (
  "id" BIGSERIAL NOT NULL,
  "report_date" DATE NOT NULL,
  "report_type" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "org_id" BIGINT,
  "recipient_email" TEXT,
  "recipient_key" TEXT NOT NULL,
  "recipient_type" "ReportRecipientType" NOT NULL,
  "status" "ReportEmailDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "sent_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_email_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_email_deliveries_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("org_id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "report_email_deliveries_report_date_report_type_file_name_recipient_key_key"
  ON "report_email_deliveries" ("report_date", "report_type", "file_name", "recipient_key");
CREATE INDEX "report_email_deliveries_report_date_status_recipient_type_idx"
  ON "report_email_deliveries" ("report_date", "status", "recipient_type");
CREATE INDEX "report_email_deliveries_org_id_report_date_idx"
  ON "report_email_deliveries" ("org_id", "report_date" DESC);

CREATE TABLE "report_email_delivery_attempts" (
  "id" BIGSERIAL NOT NULL,
  "delivery_id" BIGINT NOT NULL,
  "mail_run_id" BIGINT,
  "attempt_no" INTEGER NOT NULL,
  "forced" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "ReportEmailDeliveryStatus" NOT NULL,
  "error_text" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "report_email_delivery_attempts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "report_email_delivery_attempts_delivery_id_fkey"
    FOREIGN KEY ("delivery_id") REFERENCES "report_email_deliveries"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "report_email_delivery_attempts_mail_run_id_fkey"
    FOREIGN KEY ("mail_run_id") REFERENCES "mail_runs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "report_email_delivery_attempts_delivery_id_created_at_idx"
  ON "report_email_delivery_attempts" ("delivery_id", "created_at" DESC);
CREATE INDEX "report_email_delivery_attempts_mail_run_id_created_at_idx"
  ON "report_email_delivery_attempts" ("mail_run_id", "created_at" DESC);
