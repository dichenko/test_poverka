import { ReportEmailDeliveryStatus } from "@prisma/client";
import { z } from "zod";

const reportDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const reportMailRunBodySchema = z.object({
  date: reportDateSchema,
  force: z.coerce.boolean().optional().default(false)
});

export const reportMailSendOneBodySchema = z
  .object({
    date: reportDateSchema.optional(),
    fileName: z.string().trim().min(1).optional(),
    filePath: z.string().trim().min(1).optional(),
    deliveryId: z.coerce.bigint().positive().optional(),
    force: z.coerce.boolean().optional().default(false)
  })
  .refine((value) => Boolean(value.fileName || value.filePath || value.deliveryId), {
    message: "Provide one of: fileName, filePath, deliveryId"
  });

export const reportMailStatusQuerySchema = z.object({
  date: reportDateSchema,
  status: z.nativeEnum(ReportEmailDeliveryStatus).optional(),
  orgId: z.coerce.bigint().positive().optional(),
  fileName: z.string().trim().min(1).optional()
});
