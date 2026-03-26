import { AuditEntityType } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../common/prisma";

interface LogAuditInput {
  actorUserId?: string | null;
  action: string;
  entityType: AuditEntityType;
  entityId?: string | null;
  meta?: unknown;
  req?: Request;
}

export async function logAuditEvent(input: LogAuditInput) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      meta: input.meta ? (input.meta as object) : undefined,
      ip: input.req?.ip ?? null,
      userAgent: input.req?.headers["user-agent"] ?? null
    }
  });
}
