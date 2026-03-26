import { SubmissionStatus } from "@prisma/client";
import { z } from "zod";

export const createDraftSubmissionSchema = z.object({
  meterNumber: z.string().trim().min(3).max(64),
  currentValue: z
    .string()
    .trim()
    .regex(/^\d+([.,]\d{1,3})?$/, "currentValue must be numeric")
});

export const confirmSubmissionParamsSchema = z.object({
  id: z.string().cuid()
});

export const listSubmissionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
  status: z.nativeEnum(SubmissionStatus).optional()
});
