import { UserRole } from "@prisma/client";
import type { Request, Response } from "express";
import { AppError } from "../../common/app-error";
import { prisma } from "../../common/prisma";
import { env, isProduction } from "../../config/env";
import { logAuditEvent } from "../../services/audit.service";
import { createRefreshToken, hashToken, signAccessToken } from "../../services/token.service";
import type { ValidatedMaxInitData } from "./max-init-data";

function getRefreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.AUTH_COOKIE_SECURE || isProduction,
    sameSite: "lax" as const,
    path: "/api/auth",
    maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  };
}

function parseUserId(raw: string): bigint {
  try {
    return BigInt(raw);
  } catch {
    throw new AppError("Invalid MAX user id.", 400, "MAX_USER_ID_INVALID");
  }
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

  const numericUserId = parseUserId(validated.maxUserId);
  const user = await prisma.user.findUnique({
    where: { id: numericUserId },
    include: { organization: true }
  });

  if (!user) {
    throw new AppError("User is not found in the access list.", 403, "USER_NOT_FOUND");
  }
  if (user.role === UserRole.USER && !user.organizationId) {
    throw new AppError("User has no organization assigned.", 403, "USER_ORG_REQUIRED");
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
    sub: user.id.toString(),
    maxUserId: user.id.toString(),
    role: user.role
  });

  await logAuditEvent({
    actorUserId: user.id.toString(),
    action: "auth.session.created",
    entityType: "AUTH_SESSION",
    meta: {
      role: user.role,
      maxUserId: user.id.toString()
    },
    req
  });

  return {
    accessToken,
    user: {
      id: user.id.toString(),
      maxUserId: user.id.toString(),
      firstName: null,
      lastName: null,
      fullName: user.fullName,
      username: null,
      role: user.role,
      organizationId: user.organizationId?.toString() ?? null,
      organizationName: user.organization?.name ?? null,
      organizationBalance: user.organization?.balance?.toString() ?? null,
      organizationTarif: user.organization?.userTarif?.toString() ?? null
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
    sub: session.user.id.toString(),
    maxUserId: session.user.id.toString(),
    role: session.user.role
  });

  return {
    accessToken,
    user: {
      id: session.user.id.toString(),
      maxUserId: session.user.id.toString(),
      fullName: session.user.fullName,
      role: session.user.role,
      organizationId: session.user.organizationId?.toString() ?? null
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
