ALTER TABLE "generated_reports"
  ADD COLUMN "organization_id" BIGINT;

ALTER TABLE "generated_reports"
  ADD CONSTRAINT "generated_reports_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("org_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

DROP INDEX IF EXISTS "generated_reports_report_code_report_date_key";

CREATE UNIQUE INDEX "generated_reports_report_code_report_date_organization_id_key"
  ON "generated_reports" ("report_code", "report_date", "organization_id");

CREATE UNIQUE INDEX "generated_reports_report_code_report_date_null_org_key"
  ON "generated_reports" ("report_code", "report_date")
  WHERE "organization_id" IS NULL;

CREATE INDEX "generated_reports_organization_id_report_date_idx"
  ON "generated_reports" ("organization_id", "report_date" DESC);
