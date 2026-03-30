ALTER TABLE "organization_topups"
  ADD COLUMN IF NOT EXISTS "provider_confirmation_url" TEXT;

UPDATE "organization_topups"
SET "provider_confirmation_url" = "provider_invoice_url"
WHERE "provider_confirmation_url" IS NULL
  AND "provider_invoice_url" IS NOT NULL;

UPDATE "organization_topups"
SET "status" = 'awaiting_payment'
WHERE "status" = 'finalizing';

ALTER TABLE "organization_topups"
  DROP CONSTRAINT IF EXISTS "organization_topups_status_check";

ALTER TABLE "organization_topups"
  ADD CONSTRAINT "organization_topups_status_check"
  CHECK ("status" IN ('awaiting_payment', 'paid', 'expired', 'canceled', 'failed'));

DROP INDEX IF EXISTS "organization_topups_active_user_unique";

CREATE UNIQUE INDEX "organization_topups_active_user_unique"
  ON "organization_topups"("user_id")
  WHERE "status" IN ('awaiting_payment');

DROP INDEX IF EXISTS "organization_topups_provider_invoice_id_unique";

CREATE UNIQUE INDEX IF NOT EXISTS "organization_topups_provider_payment_id_unique"
  ON "organization_topups"("provider_payment_id")
  WHERE "provider_payment_id" IS NOT NULL;

ALTER TABLE "organization_topups"
  DROP COLUMN IF EXISTS "provider_invoice_id",
  DROP COLUMN IF EXISTS "provider_invoice_url";

ALTER TABLE "yookassa_webhook_log"
  ALTER COLUMN "remote_ip" TYPE INET
  USING CASE
    WHEN "remote_ip" IS NULL OR BTRIM("remote_ip") = '' THEN NULL
    ELSE "remote_ip"::INET
  END;
