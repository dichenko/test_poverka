ALTER TABLE "generated_reports"
ADD COLUMN "public_token" TEXT;

UPDATE "generated_reports"
SET "public_token" = md5(
  "id"::text || ':' || "report_code" || ':' || "file_name" || ':' || clock_timestamp()::text || ':' || random()::text
) || '_' || "id"::text
WHERE "public_token" IS NULL;

UPDATE "generated_reports"
SET "public_url" = regexp_replace("public_url", ('/' || "report_code" || '/.*$'), '') || '/' || "public_token"
WHERE "public_url" ~ ('/' || "report_code" || '/');

UPDATE "generated_reports"
SET "public_url" = regexp_replace("public_url", '/[^/]*$', '') || '/' || "public_token"
WHERE "public_url" !~ ('/' || "report_code" || '/');

ALTER TABLE "generated_reports"
ALTER COLUMN "public_token" SET NOT NULL;

CREATE UNIQUE INDEX "generated_reports_public_token_key"
ON "generated_reports"("public_token");
