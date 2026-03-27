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

router.get("/admin/organizations", async (_req, res, next) => {
  try {
    const organizations = await prisma.organization.findMany({
      orderBy: { name: "asc" }
    });
    res.json({
      ok: true,
      organizations: organizations.map((org: any) => ({
        id: org.id.toString(),
        name: org.name,
        email: org.email,
        balance: org.balance,
        balanceStartOfDay: org.balanceStartOfDay,
        userTarif: org.userTarif
      }))
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
        organization: {
          id: organization.id.toString(),
          name: organization.name,
          email: organization.email,
          balance: organization.balance,
          balanceStartOfDay: organization.balanceStartOfDay,
          userTarif: organization.userTarif
        }
      });
    } catch (error) {
      return next(error);
    }
  }
);

router.get("/admin/users", validate(adminListUsersQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = adminListUsersQuerySchema.parse(req.query);
    const where: Prisma.UserWhereInput = {
      role: query.role,
      organizationId: query.organizationId,
      isActive: query.isActive,
      OR: query.search
        ? [
            { fullName: { contains: query.search, mode: "insensitive" } },
            { username: { contains: query.search, mode: "insensitive" } },
            { maxUserId: { contains: query.search, mode: "insensitive" } }
          ]
        : undefined
    };

    const users = await prisma.user.findMany({
      where,
      include: { organization: true },
      orderBy: [{ role: "desc" }, { createdAt: "desc" }],
      take: query.limit
    });

    res.json({
      ok: true,
      users: users.map((user: any) => ({
        id: user.id,
        maxUserId: user.maxUserId,
        fullName: user.fullName,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        phone: user.phone,
        role: user.role,
        isActive: user.isActive,
        organizationId: user.organizationId?.toString() ?? null,
        organizationName: user.organization?.name ?? null,
        createdAt: user.createdAt
      }))
    });
  } catch (error) {
    next(error);
  }
});

router.post("/admin/users", validate(adminCreateUserSchema), async (req, res, next) => {
  try {
    const fullName = [req.body.firstName, req.body.lastName].filter(Boolean).join(" ").trim();
    const user = await prisma.user.create({
      data: {
        maxUserId: req.body.maxUserId,
        firstName: req.body.firstName,
        lastName: req.body.lastName ?? null,
        fullName,
        username: req.body.username ?? null,
        phone: req.body.phone ?? null,
        role: req.body.role,
        organizationId: req.body.organizationId ?? null,
        isActive: req.body.isActive
      }
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "admin.user.created",
      entityType: "USER",
      entityId: user.id,
      meta: { role: user.role, organizationId: user.organizationId?.toString() ?? null },
      req
    });

    res.status(201).json({
      ok: true,
      user: {
        ...user,
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
      const existing = await prisma.user.findUnique({
        where: { id: params.id }
      });
      if (!existing) {
        return res.status(404).json({
          ok: false,
          error: { code: "USER_NOT_FOUND", message: "User not found." }
        });
      }

      const nextFirstName = req.body.firstName ?? existing.firstName;
      const nextLastName = req.body.lastName ?? existing.lastName;
      const fullName = [nextFirstName, nextLastName].filter(Boolean).join(" ").trim();

      const user = await prisma.user.update({
        where: { id: params.id },
        data: {
          maxUserId: req.body.maxUserId,
          firstName: req.body.firstName,
          lastName: req.body.lastName,
          fullName,
          username: req.body.username,
          phone: req.body.phone,
          role: req.body.role,
          organizationId: req.body.organizationId,
          isActive: req.body.isActive
        }
      });

      await logAuditEvent({
        actorUserId: req.auth!.userId,
        action: "admin.user.updated",
        entityType: "USER",
        entityId: user.id,
        meta: {
          ...req.body,
          organizationId: req.body.organizationId?.toString() ?? null
        },
        req
      });

      return res.json({
        ok: true,
        user: {
          ...user,
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
        organization: true
      },
      orderBy: { createdAt: "desc" },
      take: query.limit
    });

    res.json({
      ok: true,
      submissions: submissions.map((item: any) => ({
        id: item.id,
        meterNumber: item.meterNumber,
        currentValue: item.currentValue.toString(),
        status: item.status,
        source: item.source,
        createdAt: item.createdAt,
        confirmedAt: item.confirmedAt,
        user: {
          id: item.user.id,
          fullName: item.user.fullName,
          maxUserId: item.user.maxUserId
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
        history: history.map((item: any) => ({
          id: item.id,
          oldStatus: item.oldStatus,
          newStatus: item.newStatus,
          reason: item.reason,
          createdAt: item.createdAt,
          changedBy: item.changedByUser
            ? {
                id: item.changedByUser.id,
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
      logs: logs.map((item: any) => ({
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
              id: item.actorUser.id,
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
