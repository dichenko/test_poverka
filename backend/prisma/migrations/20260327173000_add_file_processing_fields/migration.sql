-- AlterTable
ALTER TABLE "files"
  ADD COLUMN "processed_at" TIMESTAMP(3),
  ADD COLUMN "processing_error" TEXT,
  ADD COLUMN "compressed_path" TEXT;