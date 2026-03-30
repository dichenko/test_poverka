CREATE TYPE "GeneratedReportStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR');

CREATE TABLE "generated_reports" (
  "id" BIGSERIAL NOT NULL,
  "report_code" TEXT NOT NULL,
  "report_date" DATE NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "public_url" TEXT NOT NULL,
  "status" "GeneratedReportStatus" NOT NULL DEFAULT 'PENDING',
  "rows_count" INTEGER NOT NULL DEFAULT 0,
  "error_text" TEXT,
  "started_at" TIMESTAMPTZ(3),
  "finished_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "generated_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "generated_reports_report_code_report_date_key"
  ON "generated_reports" ("report_code", "report_date");

CREATE INDEX "generated_reports_status_report_date_idx"
  ON "generated_reports" ("status", "report_date" DESC);
