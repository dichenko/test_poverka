import "server-only";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export function getReadableError(error: unknown, fallback: string): string {
  if (error instanceof ZodError) {
    return error.issues[0]?.message ?? fallback;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return "Unique constraint violation. Value already exists.";
    }
    if (error.code === "P2003") {
      return "Cannot delete this record because related records exist.";
    }
    if (error.code === "P2025") {
      return "Record not found.";
    }
  }

  return fallback;
}

