CREATE TYPE "OcrRecognitionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

CREATE TABLE "ocr_recognitions" (
    "id" TEXT NOT NULL,
    "file_id" TEXT NOT NULL,
    "original_path" TEXT NOT NULL,
    "original_mime_type" TEXT NOT NULL,
    "compressed_photo_url" TEXT NOT NULL,
    "result_json_url" TEXT,
    "status" "OcrRecognitionStatus" NOT NULL DEFAULT 'PENDING',
    "ocr_status" TEXT,
    "response_payload" JSONB,
    "attempts_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ocr_recognitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ocr_recognitions_file_id_key" ON "ocr_recognitions"("file_id");
CREATE INDEX "ocr_recognitions_status_next_attempt_at_idx" ON "ocr_recognitions"("status", "next_attempt_at");

ALTER TABLE "ocr_recognitions" ADD CONSTRAINT "ocr_recognitions_file_id_fkey"
  FOREIGN KEY ("file_id") REFERENCES "files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
