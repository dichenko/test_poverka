import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import { AppError } from "../../common/app-error";
import { prisma } from "../../common/prisma";
import { env, isProduction } from "../../config/env";
import { logAuditEvent } from "../../services/audit.service";
import { createRefreshToken, hashToken, signAccessToken } from "../../services/token.service";
import type { ValidatedMaxInitData } from "./max-init-data";

function buildFullName(firstName?: string, lastName?: string) {
  return [firstName, lastName].filter(Boolean).join(" ").trim();
}

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE || isProduction,
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  };
}

export async function createAuthSession(input: {
  validated: ValidatedMaxInitData;
  req: Request;
  res: Response;
}) {
  const { validated, req, res } = input;

  await prisma.initDataReplay.deleteMany({
    where: {
      expiresAt: {
        lt: new Date()
      }
    }
  });

  const existingReplay = await prisma.initDataReplay.findUnique({
    where: { replayKey: validated.replayKey }
  });
  if (existingReplay) {
    throw new AppError("Repeated initData replay detected.", 401, "INITDATA_REPLAY");
  }

  await prisma.initDataReplay.create({
    data: {
      replayKey: validated.replayKey,
      maxUserId: validated.maxUserId,
      expiresAt: new Date(Date.now() + env.INITDATA_REPLAY_TTL_SECONDS * 1000)
    }
  });

  const user = await prisma.user.findUnique({
    where: { maxUserId: validated.maxUserId },
    include: { organization: true }
  });

  if (!user) {
    throw new AppError("User is not found in the access list.", 403, "USER_NOT_FOUND");
  }
  if (!user.isActive) {
    throw new AppError("Account is inactive.", 403, "USER_INACTIVE");
  }
  if (user.role === UserRole.USER && !user.organizationId) {
    throw new AppError("User has no organization assigned.", 403, "USER_ORG_REQUIRED");
  }

  const patchedFullName = buildFullName(validated.firstName, validated.lastName);
  if (validated.firstName && patchedFullName && patchedFullName !== user.fullName) {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        firstName: validated.firstName,
        lastName: validated.lastName ?? user.lastName,
        fullName: patchedFullName,
        username: validated.username ?? user.username,
        lastLoginAt: new Date()
      }
    });
  } else {
    await prisma.user.update({
      where: { id: user.id },
      data: {
        username: validated.username ?? user.username,
        lastLoginAt: new Date()
      }
    });
  }

  const refreshToken = createRefreshToken();
  const refreshTokenHash = hashToken(refreshToken);
  const refreshTokenExpiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.authRefreshToken.create({
    data: {
      userId: user.id,
      tokenHash: refreshTokenHash,
      expiresAt: refreshTokenExpiresAt,
      createdByIp: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null
    }
  });

  res.cookie(env.REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions());

  const accessToken = signAccessToken({
    sub: user.id,
    maxUserId: user.maxUserId,
    role: user.role
  });

  await logAuditEvent({
    actorUserId: user.id,
    action: "auth.session.created",
    entityType: "AUTH_SESSION",
    meta: {
      role: user.role,
      maxUserId: user.maxUserId
    },
    req
  });

  return {
    accessToken,
    user: {
      id: user.id,
      maxUserId: user.maxUserId,
      firstName: user.firstName,
      lastName: user.lastName,
      fullName: user.fullName,
      username: user.username,
      role: user.role,
      organizationId: user.organizationId?.toString() ?? null,
      organizationName: user.organization?.name ?? null,
      isActive: user.isActive
    }
  };
}

export async function rotateRefreshToken(req: Request, res: Response) {
  const rawToken = String(req.cookies?.[env.REFRESH_COOKIE_NAME] ?? "");
  if (!rawToken) {
    throw new AppError("Refresh token is required.", 401, "REFRESH_REQUIRED");
  }

  const currentHash = hashToken(rawToken);
  const session = await prisma.authRefreshToken.findUnique({
    where: { tokenHash: currentHash },
    include: { user: true }
  });

  if (!session || session.revokedAt || session.expiresAt < new Date()) {
    throw new AppError("Refresh token is invalid or expired.", 401, "REFRESH_INVALID");
  }
  if (!session.user.isActive) {
    throw new AppError("Account is inactive.", 403, "USER_INACTIVE");
  }

  const newToken = createRefreshToken();
  const newTokenHash = hashToken(newToken);
  const newExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction([
    prisma.authRefreshToken.update({
      where: { id: session.id },
      data: {
        revokedAt: new Date(),
        replacedByToken: newTokenHash
      }
    }),
    prisma.authRefreshToken.create({
      data: {
        userId: session.userId,
        tokenHash: newTokenHash,
        expiresAt: newExpiry,
        createdByIp: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null
      }
    })
  ]);

  res.cookie(env.REFRESH_COOKIE_NAME, newToken, getRefreshCookieOptions());

  const accessToken = signAccessToken({
    sub: session.user.id,
    maxUserId: session.user.maxUserId,
    role: session.user.role
  });

  return {
    accessToken,
    user: {
      id: session.user.id,
      maxUserId: session.user.maxUserId,
      fullName: session.user.fullName,
      role: session.user.role,
      organizationId: session.user.organizationId?.toString() ?? null,
      isActive: session.user.isActive
    }
  };
}

export async function revokeRefreshToken(req: Request, res: Response) {
  const rawToken = String(req.cookies?.[env.REFRESH_COOKIE_NAME] ?? "");
  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await prisma.authRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() }
    });
  }
  res.clearCookie(env.REFRESH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.AUTH_COOKIE_SECURE || isProduction,
    path: "/api/auth"
  });
}
