import "server-only";
import { UserRole } from "@prisma/client";
import { z } from "zod";

const idSchema = z.string().trim().regex(/^\d+$/, "Invalid identifier").transform((value) => BigInt(value));
const rublesSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, "Amount must be a non-negative integer")
  .transform((value) => BigInt(value));

const optionalRublesSchema = z.union([z.literal(""), rublesSchema]).transform((value) => (value === "" ? null : value));
const optionalEmailSchema = z
  .union([z.literal(""), z.string().trim().email("Invalid email format")])
  .transform((value) => (value === "" ? null : value));

function optionalTextSchema(max: number, label: string) {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long`)
    .transform((value) => (value.length === 0 ? null : value));
}

const optionalOrgIdSchema = z.union([z.literal(""), idSchema]).transform((value) => (value === "" ? null : value));
const optionalTarifSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || Number.isFinite(Number(value)), "Tariff must be a number")
  .transform((value) => (value === "" ? null : Number(value)))
  .refine((value) => value === null || value >= 0, "Tariff must be non-negative");

function readField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

const organizationSchema = z.object({
  id: idSchema.optional(),
  name: z.string().trim().min(2, "Name is required").max(255, "Name is too long"),
  email: optionalEmailSchema,
  balance: rublesSchema,
  userTarif: rublesSchema,
  balanceStartOfDay: optionalRublesSchema
});

const userSchema = z.object({
  id: idSchema.optional(),
  maxUserId: idSchema.optional(),
  fullName: z.string().trim().min(1, "Full name is required").max(255, "Full name is too long"),
  role: z.nativeEnum(UserRole),
  organizationId: optionalOrgIdSchema,
  phone: optionalTextSchema(64, "Phone"),
  city: optionalTextSchema(128, "City"),
  userTarif: optionalTarifSchema,
  orgName: optionalTextSchema(255, "Organization name"),
  orgEmail: optionalEmailSchema
});

export function parseOrganizationForm(formData: FormData) {
  return organizationSchema.parse({
    id: readField(formData, "id") || undefined,
    name: readField(formData, "name"),
    email: readField(formData, "email"),
    balance: readField(formData, "balance"),
    userTarif: readField(formData, "userTarif"),
    balanceStartOfDay: readField(formData, "balanceStartOfDay")
  });
}

export function parseUserForm(formData: FormData) {
  return userSchema.parse({
    id: readField(formData, "id") || undefined,
    maxUserId: readField(formData, "maxUserId") || undefined,
    fullName: readField(formData, "fullName"),
    role: readField(formData, "role"),
    organizationId: readField(formData, "organizationId"),
    phone: readField(formData, "phone"),
    city: readField(formData, "city"),
    userTarif: readField(formData, "userTarif"),
    orgName: readField(formData, "orgName"),
    orgEmail: readField(formData, "orgEmail")
  });
}

export function parseIdFromForm(formData: FormData, key = "id"): bigint {
  return idSchema.parse(readField(formData, key));
}
