CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "organizations"
  ADD COLUMN "balance_kopecks" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "tariff_per_package_kopecks" BIGINT NOT NULL DEFAULT 0;

UPDATE "organizations"
SET
  "balance_kopecks" = GREATEST(0, ROUND(COALESCE("balance", 0) * 100)::BIGINT),
  "tariff_per_package_kopecks" = GREATEST(0, ROUND(COALESCE("user_tarif", 0) * 100)::BIGINT);

ALTER TABLE "submission_billing_events"
  ADD COLUMN "amount_kopecks" BIGINT NOT NULL DEFAULT 0;

UPDATE "submission_billing_events"
SET "amount_kopecks" = GREATEST(0, ROUND(COALESCE("amount", 0) * 100)::BIGINT);

CREATE TABLE "organization_topups" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" BIGINT NOT NULL,
  "user_id" BIGINT NOT NULL,
  "status" TEXT NOT NULL,
  "packages_count" INTEGER NOT NULL,
  "tariff_per_package_kopecks" BIGINT NOT NULL,
  "amount_kopecks" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "provider" TEXT NOT NULL DEFAULT 'yookassa',
  "provider_invoice_id" TEXT,
  "provider_invoice_url" TEXT,
  "provider_payment_id" TEXT,
  "provider_status" TEXT,
  "provider_idempotence_key" TEXT,
  "expires_at" TIMESTAMPTZ(3) NOT NULL,
  "paid_at" TIMESTAMPTZ(3),
  "canceled_at" TIMESTAMPTZ(3),
  "cancel_reason_code" TEXT,
  "cancel_reason_text" TEXT,
  "last_provider_sync_at" TIMESTAMPTZ(3),
  "next_poll_at" TIMESTAMPTZ(3),
  "poll_attempts" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_topups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_topups_status_check" CHECK ("status" IN ('awaiting_payment', 'paid', 'expired', 'canceled', 'failed', 'finalizing')),
  CONSTRAINT "organization_topups_packages_count_check" CHECK ("packages_count" > 0),
  CONSTRAINT "organization_topups_amount_kopecks_check" CHECK ("amount_kopecks" > 0),
  CONSTRAINT "organization_topups_tariff_kopecks_check" CHECK ("tariff_per_package_kopecks" > 0)
);

CREATE TABLE "organization_balance_transactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" BIGINT NOT NULL,
  "direction" TEXT NOT NULL,
  "amount_kopecks" BIGINT NOT NULL,
  "balance_before_kopecks" BIGINT NOT NULL,
  "balance_after_kopecks" BIGINT NOT NULL,
  "source_type" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "created_by_user_id" BIGINT,
  "comment" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_balance_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_balance_transactions_direction_check" CHECK ("direction" IN ('credit', 'debit')),
  CONSTRAINT "organization_balance_transactions_amount_check" CHECK ("amount_kopecks" > 0)
);

CREATE TABLE "organization_topup_payment_attempts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "topup_id" UUID NOT NULL,
  "provider_invoice_id" TEXT,
  "provider_payment_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amount_kopecks" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'RUB',
  "paid" BOOLEAN NOT NULL DEFAULT FALSE,
  "cancellation_party" TEXT,
  "cancellation_reason" TEXT,
  "raw_payload" JSONB,
  "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "paid_at" TIMESTAMPTZ(3),
  "canceled_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "organization_topup_payment_attempts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "yookassa_webhook_log" (
  "id" BIGSERIAL NOT NULL,
  "event_type" TEXT NOT NULL,
  "provider_object_id" TEXT NOT NULL,
  "topup_id" UUID,
  "remote_ip" TEXT,
  "is_trusted_ip" BOOLEAN NOT NULL DEFAULT FALSE,
  "headers" JSONB,
  "payload" JSONB NOT NULL,
  "payload_sha256" TEXT NOT NULL,
  "processing_status" TEXT NOT NULL DEFAULT 'received',
  "processing_error" TEXT,
  "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMPTZ(3),
  CONSTRAINT "yookassa_webhook_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bot_user_states" (
  "user_id" BIGINT NOT NULL,
  "state" TEXT NOT NULL,
  "payload" JSONB,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bot_user_states_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX "organization_topups_active_user_unique"
  ON "organization_topups"("user_id")
  WHERE "status" IN ('awaiting_payment', 'finalizing');

CREATE UNIQUE INDEX "organization_topups_provider_invoice_id_unique"
  ON "organization_topups"("provider_invoice_id")
  WHERE "provider_invoice_id" IS NOT NULL;

CREATE INDEX "organization_topups_status_next_poll_at_idx"
  ON "organization_topups"("status", "next_poll_at");

CREATE INDEX "organization_topups_organization_id_created_at_idx"
  ON "organization_topups"("organization_id", "created_at" DESC);

CREATE INDEX "organization_topups_user_id_status_idx"
  ON "organization_topups"("user_id", "status");

CREATE UNIQUE INDEX "organization_balance_transactions_source_unique"
  ON "organization_balance_transactions"("source_type", "source_id", "direction");

CREATE INDEX "organization_balance_transactions_org_created_idx"
  ON "organization_balance_transactions"("organization_id", "created_at" DESC);

CREATE UNIQUE INDEX "organization_topup_payment_attempts_payment_id_key"
  ON "organization_topup_payment_attempts"("provider_payment_id");

CREATE INDEX "organization_topup_payment_attempts_topup_created_idx"
  ON "organization_topup_payment_attempts"("topup_id", "created_at" DESC);

CREATE UNIQUE INDEX "yookassa_webhook_log_payload_sha256_key"
  ON "yookassa_webhook_log"("payload_sha256");

CREATE INDEX "yookassa_webhook_log_provider_object_id_idx"
  ON "yookassa_webhook_log"("provider_object_id");

ALTER TABLE "organization_topups"
  ADD CONSTRAINT "organization_topups_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_topups"
  ADD CONSTRAINT "organization_topups_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_balance_transactions"
  ADD CONSTRAINT "organization_balance_transactions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("org_id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "organization_balance_transactions"
  ADD CONSTRAINT "organization_balance_transactions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("user_id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "organization_topup_payment_attempts"
  ADD CONSTRAINT "organization_topup_payment_attempts_topup_id_fkey"
  FOREIGN KEY ("topup_id") REFERENCES "organization_topups"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "yookassa_webhook_log"
  ADD CONSTRAINT "yookassa_webhook_log_topup_id_fkey"
  FOREIGN KEY ("topup_id") REFERENCES "organization_topups"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bot_user_states"
  ADD CONSTRAINT "bot_user_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id")
  ON DELETE CASCADE ON UPDATE CASCADE;