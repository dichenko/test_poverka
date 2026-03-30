import { Prisma, UserRole } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../../common/prisma";
import { validate } from "../../common/validate";
import { requireAuth, requireRole } from "../../middlewares/auth";
import { logAuditEvent } from "../../services/audit.service";
import {
  adminAuditLogsQuerySchema,
  adminCreateUserSchema,
  adminListSubmissionsQuerySchema,
  adminListUsersQuerySchema,
  adminOrgParamsSchema,
  adminSubmissionParamsSchema,
  adminUpdateOrganizationSchema,
  adminUpdateUserSchema,
  adminUserParamsSchema
} from "./admin.schemas";

const router = Router();

router.use(requireAuth, requireRole([UserRole.ADMIN]));

function serializeOrganization(org: {
  id: bigint;
  name: string;
  email: string | null;
  balance: bigint;
  balanceStartOfDay: bigint | null;
  userTarif: bigint;
}) {
  return {
    id: org.id.toString(),
    name: org.name,
    email: org.email,
    balance: org.balance.toString(),
    balanceStartOfDay: org.balanceStartOfDay?.toString() ?? null,
    userTarif: org.userTarif.toString()
  };
}

router.get("/admin/organizations", async (_req, res, next) => {
  try {
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" }
    });
    res.json({
      ok: true,
      organizations: organizations.map((org) => serializeOrganization(org))
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/organizations/:id",
  validate(adminOrgParamsSchema, "params"),
  validate(adminUpdateOrganizationSchema),
  async (req, res, next) => {
    try {
      const params = adminOrgParamsSchema.parse(req.params);
      const body = adminUpdateOrganizationSchema.parse(req.body);
      const organization = await prisma.organization.update({
        where: { id: params.id },
        data: {
          name: body.name,
          email: body.email ?? undefined,
          balance: body.balance ?? undefined,
          balanceStartOfDay: body.balanceStartOfDay ?? undefined,
          userTarif: body.userTarif ?? undefined
        }
      });

      await logAuditEvent({
        actorUserId: req.auth!.userId,
        action: "admin.organization.updated",
        entityType: "ORGANIZATION",
        entityId: organization.id.toString(),
        meta: body,
        req
      });

      return res.json({
        ok: true,
        organization: serializeOrganization(organization)
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/admin/users", validate(adminListUsersQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = adminListUsersQuerySchema.parse(req.query);
    const searchId = query.search && /^\d+$/.test(query.search) ? BigInt(query.search) : undefined;
    const where: Prisma.UserWhereInput = {
      role: query.role,
      organizationId: query.organizationId,
      OR: query.search
        ? [
            { fullName: { contains: query.search, mode: "insensitive" } },
            { phone: { contains: query.search, mode: "insensitive" } },
            ...(searchId ? [{ id: searchId }] : [])
          ]
        : undefined
    };

    const users = await prisma.user.findMany({
      where,
      include: { organization: true },
      orderBy: [{ role: "desc" }, { id: "desc" }],
      take: query.limit
    });

    res.json({
      ok: true,
      users: users.map((user) => ({
        id: user.id.toString(),
        fullName: user.fullName,
        phone: user.phone,
        city: user.city,
        role: user.role,
        userTarif: user.userTarif,
        organizationId: user.organizationId?.toString() ?? null,
        organizationName: user.organization?.name ?? null,
        orgName: user.orgName,
        orgEmail: user.orgEmail
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/users", validate(adminCreateUserSchema), async (req, res, next) => {
  try {
    const user = await prisma.user.create({
      data: {
        fullName: req.body.fullName,
        phone: req.body.phone ?? null,
        city: req.body.city ?? null,
        role: req.body.role,
        userTarif: req.body.userTarif ?? null,
        organizationId: req.body.organizationId ?? null,
        orgName: req.body.orgName ?? null,
        orgEmail: req.body.orgEmail ?? null
      }
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "admin.user.created",
      entityType: "USER",
      entityId: user.id.toString(),
      meta: { role: user.role, organizationId: user.organizationId?.toString() ?? null },
      req
    });

    res.status(201).json({
      ok: true,
      user: {
        id: user.id.toString(),
        fullName: user.fullName,
        phone: user.phone,
        city: user.city,
        role: user.role,
        organizationId: user.organizationId?.toString() ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

router.patch(
  "/admin/users/:id",
  validate(adminUserParamsSchema, "params"),
  validate(adminUpdateUserSchema),
  async (req, res, next) => {
    try {
      const params = adminUserParamsSchema.parse(req.params);

      const user = await prisma.user.update({
        where: { id: params.id },
        data: {
          fullName: req.body.fullName,
          phone: req.body.phone,
          city: req.body.city,
          role: req.body.role,
          userTarif: req.body.userTarif,
          organizationId: req.body.organizationId,
          orgName: req.body.orgName,
          orgEmail: req.body.orgEmail
        }
      });

      await logAuditEvent({
        actorUserId: req.auth!.userId,
        action: "admin.user.updated",
        entityType: "USER",
        entityId: user.id.toString(),
        meta: {
          ...req.body,
          organizationId: req.body.organizationId?.toString() ?? null
        },
        req
      });

      return res.json({
        ok: true,
        user: {
          id: user.id.toString(),
          fullName: user.fullName,
          phone: user.phone,
          city: user.city,
          role: user.role,
          organizationId: user.organizationId?.toString() ?? null
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/admin/submissions", validate(adminListSubmissionsQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = adminListSubmissionsQuerySchema.parse(req.query);
    const submissions = await prisma.meterSubmission.findMany({
      where: {
        organizationId: query.organizationId,
        userId: query.userId,
        status: query.status,
        createdAt:
          query.from || query.to
            ? {
                gte: query.from ? new Date(query.from) : undefined,
                lte: query.to ? new Date(query.to) : undefined
              }
            : undefined
      },
      include: {
        user: true,
        organization: true,
        equipmentType: true
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    res.json({
      ok: true,
      submissions: submissions.map((item) => ({
        id: item.id,
        address: item.address,
        phone: item.phone,
        waterType: item.waterType,
        equipmentTypeId: item.equipmentTypeId,
        equipmentTypeName: item.equipmentType?.name ?? null,
        factoryNumber: item.meterNumber,
        productionYear: item.productionYear,
        reading: item.currentValue.toString(),
        status: item.status,
        source: item.source,
        createdAt: item.createdAt,
        confirmedAt: item.confirmedAt,
        user: {
          id: item.user.id.toString(),
          fullName: item.user.fullName,
          phone: item.user.phone
        },
        organization: {
          id: item.organization.id.toString(),
          name: item.organization.name,
          email: item.organization.email
        }
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.get(
  "/admin/submissions/:id/history",
  validate(adminSubmissionParamsSchema, "params"),
  async (req, res, next) => {
    try {
      const params = adminSubmissionParamsSchema.parse(req.params);
      const history = await prisma.submissionStatusHistory.findMany({
        where: { submissionId: params.id },
        include: { changedByUser: true },
        orderBy: { createdAt: "desc" }
      });

      res.json({
        ok: true,
        history: history.map((item) => ({
          id: item.id,
          oldStatus: item.oldStatus,
          newStatus: item.newStatus,
          reason: item.reason,
          createdAt: item.createdAt,
          changedBy: item.changedByUser
            ? {
                id: item.changedByUser.id.toString(),
                fullName: item.changedByUser.fullName
              }
            : null
        }))
      });
    } catch (error) {
      next(error);
    }
  }
);

router.get("/admin/audit-logs", validate(adminAuditLogsQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = adminAuditLogsQuerySchema.parse(req.query);
    const logs = await prisma.auditLog.findMany({
      where: {
        action: query.action ? { contains: query.action, mode: "insensitive" } : undefined,
        entityType: query.entityType
      },
      include: {
        actorUser: true
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    res.json({
      ok: true,
      logs: logs.map((item) => ({
        id: item.id,
        action: item.action,
        entityType: item.entityType,
        entityId: item.entityId,
        meta: item.meta,
        ip: item.ip,
        userAgent: item.userAgent,
        createdAt: item.createdAt,
        actor: item.actorUser
          ? {
              id: item.actorUser.id.toString(),
              fullName: item.actorUser.fullName,
              role: item.actorUser.role
            }
          : null
      }))
    });
  } catch (error) {
    next(error);
  }
});

export { router as adminRoutes };
