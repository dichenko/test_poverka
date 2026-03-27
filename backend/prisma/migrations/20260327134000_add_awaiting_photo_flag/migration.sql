-- AlterTable
ALTER TABLE "meter_submissions"
  ADD COLUMN "awaiting_photo" BOOLEAN NOT NULL DEFAULT FALSE;
