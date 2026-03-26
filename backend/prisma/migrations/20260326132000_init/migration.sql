-- Create enums
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED');
CREATE TYPE "SubmissionSource" AS ENUM ('MINIAPP', 'BOT', 'ADMIN');
CREATE TYPE "AuditEntityType" AS ENUM ('USER', 'ORGANIZATION', 'SUBMISSION', 'AUTH_SESSION', 'FILE', 'SYSTEM');

-- Create tables
CREATE TABLE "organizations" (
  "id" TEXT NOT NULL,
  "inn" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "balance" DECIMAL(14,2),
  "submission_limit" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "max_user_id" TEXT NOT NULL,
  "first_name" TEXT NOT NULL,
  "last_name" TEXT,
  "full_name" TEXT NOT NULL,
  "username" TEXT,
  "phone" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'USER',
  "organization_id" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "last_login_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "meter_submissions" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "meter_number" TEXT NOT NULL,
  "current_value" DECIMAL(14,3) NOT NULL,
  "status" "SubmissionStatus" NOT NULL,
  "source" "SubmissionSource" NOT NULL DEFAULT 'MINIAPP',
  "draft_created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "confirmed_at" TIMESTAMP(3),
  "rejected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "meter_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "submission_status_history" (
  "id" TEXT NOT NULL,
  "submission_id" TEXT NOT NULL,
  "old_status" "SubmissionStatus",
  "new_status" "SubmissionStatus" NOT NULL,
  "changed_by_user_id" TEXT,
  "reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "submission_status_history_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" "AuditEntityType" NOT NULL,
  "entity_id" TEXT,
  "meta" JSONB,
  "ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "auth_refresh_tokens" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "replaced_by_token" TEXT,
  "created_by_ip" TEXT,
  "user_agent" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "auth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "init_data_replays" (
  "id" TEXT NOT NULL,
  "replay_key" TEXT NOT NULL,
  "max_user_id" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "init_data_replays_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "files" (
  "id" TEXT NOT NULL,
  "owner_user_id" TEXT,
  "submission_id" TEXT,
  "storage_key" TEXT NOT NULL,
  "original_name" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "public_url" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX "organizations_inn_key" ON "organizations"("inn");
CREATE UNIQUE INDEX "users_max_user_id_key" ON "users"("max_user_id");
CREATE UNIQUE INDEX "auth_refresh_tokens_token_hash_key" ON "auth_refresh_tokens"("token_hash");
CREATE UNIQUE INDEX "init_data_replays_replay_key_key" ON "init_data_replays"("replay_key");
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- Secondary indexes
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "meter_submissions_user_id_created_at_idx" ON "meter_submissions"("user_id", "created_at" DESC);
CREATE INDEX "meter_submissions_organization_id_created_at_idx" ON "meter_submissions"("organization_id", "created_at" DESC);
CREATE INDEX "meter_submissions_status_created_at_idx" ON "meter_submissions"("status", "created_at" DESC);
CREATE INDEX "submission_status_history_submission_id_created_at_idx" ON "submission_status_history"("submission_id", "created_at" DESC);
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at" DESC);
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at" DESC);
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
CREATE INDEX "auth_refresh_tokens_user_id_expires_at_idx" ON "auth_refresh_tokens"("user_id", "expires_at");
CREATE INDEX "init_data_replays_expires_at_idx" ON "init_data_replays"("expires_at");
CREATE INDEX "files_owner_user_id_idx" ON "files"("owner_user_id");
CREATE INDEX "files_submission_id_idx" ON "files"("submission_id");

-- Foreign keys
ALTER TABLE "users"
  ADD CONSTRAINT "users_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "meter_submissions"
  ADD CONSTRAINT "meter_submissions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "meter_submissions"
  ADD CONSTRAINT "meter_submissions_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_status_history"
  ADD CONSTRAINT "submission_status_history_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "meter_submissions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "submission_status_history"
  ADD CONSTRAINT "submission_status_history_changed_by_user_id_fkey"
  FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "auth_refresh_tokens"
  ADD CONSTRAINT "auth_refresh_tokens_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "files"
  ADD CONSTRAINT "files_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "files"
  ADD CONSTRAINT "files_submission_id_fkey"
  FOREIGN KEY ("submission_id") REFERENCES "meter_submissions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
