-- CreateEnum
CREATE TYPE "WaterType" AS ENUM ('HVS', 'GVS');

-- AlterTable
ALTER TABLE "meter_submissions"
  ADD COLUMN "address" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "water_type" "WaterType",
  ADD COLUMN "equipment_type_id" INTEGER,
  ADD COLUMN "production_year" INTEGER;

-- Constraints (non-breaking for existing rows)
ALTER TABLE "meter_submissions"
  ADD CONSTRAINT "meter_submissions_phone_digits_check"
    CHECK ("phone" IS NULL OR "phone" ~ '^[0-9]{10}$'),
  ADD CONSTRAINT "meter_submissions_production_year_check"
    CHECK ("production_year" IS NULL OR ("production_year" >= 1950 AND "production_year" <= 2050));

-- Index
CREATE INDEX "meter_submissions_equipment_type_id_idx" ON "meter_submissions"("equipment_type_id");

-- Foreign key
ALTER TABLE "meter_submissions"
  ADD CONSTRAINT "meter_submissions_equipment_type_id_fkey"
    FOREIGN KEY ("equipment_type_id") REFERENCES "equipment_types"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
