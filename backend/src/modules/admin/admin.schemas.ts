import { UserRole } from "@prisma/client";
import { z } from "zod";

export const adminListUsersQuerySchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  organizationId: z.coerce.bigint().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === "true")),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const adminCreateUserSchema = z.object({
  maxUserId: z.string().trim().min(1),
  firstName: z.string().trim().min(1),
  lastName: z.string().trim().optional().nullable(),
  username: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  role: z.nativeEnum(UserRole),
  organizationId: z.coerce.bigint().optional().nullable(),
  isActive: z.boolean().default(true)
});

export const adminUpdateUserSchema = adminCreateUserSchema.partial().extend({
  maxUserId: z.string().trim().min(1).optional()
});

export const adminUserParamsSchema = z.object({
  id: z.string().cuid()
});

export const adminListSubmissionsQuerySchema = z.object({
  organizationId: z.coerce.bigint().optional(),
  userId: z.string().cuid().optional(),
  status: z.enum(["DRAFT", "PENDING_CONFIRMATION", "CONFIRMED", "REJECTED"]).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100)
});

export const adminAuditLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  action: z.string().trim().optional(),
  entityType: z.enum(["USER", "ORGANIZATION", "SUBMISSION", "AUTH_SESSION", "FILE", "SYSTEM"]).optional()
});

export const adminSubmissionParamsSchema = z.object({
  id: z.string().cuid()
});

export const adminOrgParamsSchema = z.object({
  id: z.coerce.bigint()
});

export const adminUpdateOrganizationSchema = z.object({
  name: z.string().trim().min(2).optional(),
  email: z.string().email().optional().nullable(),
  balance: z.number().nonnegative().nullable().optional(),
  balanceStartOfDay: z.number().nonnegative().nullable().optional(),
  userTarif: z.number().nonnegative().nullable().optional()
});
