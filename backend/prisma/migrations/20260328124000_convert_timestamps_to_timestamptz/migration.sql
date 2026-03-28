-- Convert DateTime columns to TIMESTAMPTZ (existing values are treated as UTC)
ALTER TABLE "meter_submissions"
  ALTER COLUMN "draft_created_at" TYPE TIMESTAMPTZ(3) USING ("draft_created_at" AT TIME ZONE 'UTC'),
  ALTER COLUMN "confirmed_at" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "confirmed_at" IS NULL THEN NULL ELSE "confirmed_at" AT TIME ZONE 'UTC' END),
  ALTER COLUMN "rejected_at" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "rejected_at" IS NULL THEN NULL ELSE "rejected_at" AT TIME ZONE 'UTC' END),
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC'),
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING ("updated_at" AT TIME ZONE 'UTC');

ALTER TABLE "submission_status_history"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC');

ALTER TABLE "audit_logs"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC');

ALTER TABLE "auth_refresh_tokens"
  ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ(3) USING ("expires_at" AT TIME ZONE 'UTC'),
  ALTER COLUMN "revoked_at" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "revoked_at" IS NULL THEN NULL ELSE "revoked_at" AT TIME ZONE 'UTC' END),
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC');

ALTER TABLE "init_data_replays"
  ALTER COLUMN "expires_at" TYPE TIMESTAMPTZ(3) USING ("expires_at" AT TIME ZONE 'UTC'),
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC');

ALTER TABLE "files"
  ALTER COLUMN "processed_at" TYPE TIMESTAMPTZ(3) USING (CASE WHEN "processed_at" IS NULL THEN NULL ELSE "processed_at" AT TIME ZONE 'UTC' END),
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC'),
  ALTER COLUMN "updated_at" TYPE TIMESTAMPTZ(3) USING ("updated_at" AT TIME ZONE 'UTC');

ALTER TABLE "submission_billing_events"
  ALTER COLUMN "created_at" TYPE TIMESTAMPTZ(3) USING ("created_at" AT TIME ZONE 'UTC');

-- Enforce Europe/Moscow timezone defaults at DB and role level
DO 
BEGIN
  EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'Europe/Moscow');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping ALTER DATABASE timezone: insufficient privilege';
END
;

DO 
BEGIN
  EXECUTE format('ALTER ROLE %I SET timezone TO %L', current_user, 'Europe/Moscow');
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping ALTER ROLE timezone: insufficient privilege';
END
;