-- CreateTable
CREATE TABLE "submission_billing_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "user_id" BIGINT NOT NULL,
  "organization_id" BIGINT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "submission_billing_events_submission_id_key" ON "submission_billing_events"("submission_id");
CREATE INDEX "submission_billing_events_user_id_created_at_idx" ON "submission_billing_events"("user_id", "created_at" DESC);
CREATE INDEX "submission_billing_events_organization_id_created_at_idx" ON "submission_billing_events"("organization_id", "created_at" DESC);
CREATE INDEX "submission_billing_events_created_at_idx" ON "submission_billing_events"("created_at" DESC);

-- AddForeignKey
ALTER TABLE "submission_billing_events"
  ADD CONSTRAINT "submission_billing_events_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_billing_events"
  ADD CONSTRAINT "submission_billing_events_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("org_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_billing_events"
  ADD CONSTRAINT "submission_billing_events_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "meter_submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;