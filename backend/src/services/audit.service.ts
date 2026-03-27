import { AuditEntityType } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../common/prisma";

interface LogAuditInput {
  actorUserId?: string | bigint | null;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  meta?: unknown;
  req?: Request;
}

export async function logAuditEvent(input: LogAuditInput) {
  let actorUserId: bigint | null = null;
  if (input.actorUserId !== undefined && input.actorUserId !== null && String(input.actorUserId).trim()) {
    try {
      actorUserId = BigInt(String(input.actorUserId));
    } catch {
      actorUserId = null;
    }
  }

  await prisma.auditLog.create({
    data: {
      actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      meta: input.meta ? (input.meta as object) : undefined,
      ip: input.req?.ip ?? null,
      userAgent: input.req?.headers["user-agent"] ?? null
    }
  });
}
