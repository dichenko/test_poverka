import { UserRole } from "@prisma/client";
import { z } from "zod";

export const adminListUsersQuerySchema = z.object({
  role: z.nativeEnum(UserRole).optional(),
  organizationId: z.coerce.bigint().optional(),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50)
});

export const adminCreateUserSchema = z.object({
  fullName: z.string().trim().min(1),
  phone: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  role: z.nativeEnum(UserRole).default(UserRole.USER),
  userTarif: z.number().nonnegative().optional().nullable(),
  organizationId: z.coerce.bigint().optional().nullable(),
  orgName: z.string().trim().optional().nullable(),
  orgEmail: z.string().trim().email().optional().nullable()
});

export const adminUpdateUserSchema = adminCreateUserSchema.partial();

export const adminUserParamsSchema = z.object({
  id: z.coerce.bigint()
});

export const adminListSubmissionsQuerySchema = z.object({
  organizationId: z.coerce.bigint().optional(),
  userId: z.coerce.bigint().optional(),
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
  id: z.string().trim().min(1)
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
