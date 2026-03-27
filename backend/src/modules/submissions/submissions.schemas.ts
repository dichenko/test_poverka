import { SubmissionStatus, WaterType } from "@prisma/client";
import { z } from "zod";

export const createDraftSubmissionSchema = z.object({
  address: z.string().trim().min(3).max(255),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, "phone must contain exactly 10 digits"),
  waterType: z.nativeEnum(WaterType),
  equipmentTypeId: z.coerce.number().int().positive(),
  factoryNumber: z.string().trim().regex(/^\d+$/, "factoryNumber must be numeric").max(64),
  productionYear: z.coerce.number().int().min(1950).max(2050),
  reading: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,3})?$/, "reading must be numeric")
});

export const confirmSubmissionParamsSchema = z.object({
  id: z.string().trim().min(1)
});

export const listSubmissionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.nativeEnum(SubmissionStatus).optional()
});
