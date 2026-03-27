-- CreateTable
CREATE TABLE "equipment_types" (
  "id" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  CONSTRAINT "equipment_types_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "equipment_types_name_key" ON "equipment_types"("name");

-- Seed data
INSERT INTO "equipment_types" ("id", "name") VALUES
(1, 'СГВ-15'),
(2, 'СВКМ-15'),
(3, 'СВК-15-3-2'),
(4, 'VLF-U'),
(5, 'СВК-15'),
(6, 'ВСКМ 90-15'),
(7, 'СВ-15'),
(8, 'СВУ-15'),
(9, 'VLF-R'),
(10, 'СВК-15-1,5'),
(11, 'Другая');
