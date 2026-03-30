DROP TRIGGER IF EXISTS "trg_sync_organization_tariff_fields" ON "organizations";
DROP FUNCTION IF EXISTS "sync_organization_tariff_fields"();

ALTER TABLE "organizations"
  ALTER COLUMN "balance" TYPE BIGINT
  USING COALESCE(
    ROUND("balance"),
    CASE
      WHEN "balance_kopecks" IS NULL THEN NULL
      ELSE ROUND(("balance_kopecks")::NUMERIC / 100)
    END,
    0
  )::BIGINT,
  ALTER COLUMN "balance" SET DEFAULT 0,
  ALTER COLUMN "balance" SET NOT NULL,
  ALTER COLUMN "user_tarif" TYPE BIGINT
  USING COALESCE(
    ROUND("user_tarif"),
    CASE
      WHEN "tariff_per_package_kopecks" IS NULL THEN NULL
      ELSE ROUND(("tariff_per_package_kopecks")::NUMERIC / 100)
    END,
    0
  )::BIGINT,
  ALTER COLUMN "user_tarif" SET DEFAULT 0,
  ALTER COLUMN "user_tarif" SET NOT NULL,
  ALTER COLUMN "balance_start_of_day" TYPE BIGINT
  USING CASE
    WHEN "balance_start_of_day" IS NULL THEN NULL
    ELSE ROUND("balance_start_of_day")::BIGINT
  END;

ALTER TABLE "organizations"
  DROP COLUMN IF EXISTS "balance_kopecks",
  DROP COLUMN IF EXISTS "tariff_per_package_kopecks";

ALTER TABLE "organization_topups"
  RENAME COLUMN "tariff_per_package_kopecks" TO "tariff_per_package_rubles";

ALTER TABLE "organization_topups"
  RENAME COLUMN "amount_kopecks" TO "amount_rubles";

ALTER TABLE "organization_topups"
  ALTER COLUMN "tariff_per_package_rubles" TYPE BIGINT
  USING ROUND(("tariff_per_package_rubles")::NUMERIC / 100)::BIGINT,
  ALTER COLUMN "amount_rubles" TYPE BIGINT
  USING ROUND(("amount_rubles")::NUMERIC / 100)::BIGINT;

ALTER TABLE "organization_topups"
  DROP CONSTRAINT IF EXISTS "organization_topups_amount_kopecks_check",
  DROP CONSTRAINT IF EXISTS "organization_topups_tariff_kopecks_check";

ALTER TABLE "organization_topups"
  ADD CONSTRAINT "organization_topups_amount_rubles_check" CHECK ("amount_rubles" > 0),
  ADD CONSTRAINT "organization_topups_tariff_rubles_check" CHECK ("tariff_per_package_rubles" > 0);

ALTER TABLE "organization_balance_transactions"
  RENAME COLUMN "amount_kopecks" TO "amount_rubles";

ALTER TABLE "organization_balance_transactions"
  RENAME COLUMN "balance_before_kopecks" TO "balance_before_rubles";

ALTER TABLE "organization_balance_transactions"
  RENAME COLUMN "balance_after_kopecks" TO "balance_after_rubles";

ALTER TABLE "organization_balance_transactions"
  ALTER COLUMN "amount_rubles" TYPE BIGINT
  USING ROUND(("amount_rubles")::NUMERIC / 100)::BIGINT,
  ALTER COLUMN "balance_before_rubles" TYPE BIGINT
  USING ROUND(("balance_before_rubles")::NUMERIC / 100)::BIGINT,
  ALTER COLUMN "balance_after_rubles" TYPE BIGINT
  USING ROUND(("balance_after_rubles")::NUMERIC / 100)::BIGINT;

ALTER TABLE "submission_billing_events"
  RENAME COLUMN "amount_kopecks" TO "amount_rubles";

ALTER TABLE "submission_billing_events"
  ALTER COLUMN "amount_rubles" TYPE BIGINT
  USING ROUND(("amount_rubles")::NUMERIC / 100)::BIGINT;

ALTER TABLE "organization_topup_payment_attempts"
  RENAME COLUMN "amount_kopecks" TO "amount_rubles";

ALTER TABLE "organization_topup_payment_attempts"
  ALTER COLUMN "amount_rubles" TYPE BIGINT
  USING ROUND(("amount_rubles")::NUMERIC / 100)::BIGINT;

