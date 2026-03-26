import type { NextFunction, Request, Response } from "express";
import { UserRole } from "@prisma/client";
import { AppError } from "../common/app-error";
import { verifyAccessToken } from "../services/token.service";

function parseBearerToken(authHeader?: string): string | null {
  if (!authHeader) {
    return null;
  }
  const [scheme, token] = authHeader.split(" ");
  if (scheme !== "Bearer" || !token) {
    return null;
  }
  return token.trim();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = parseBearerToken(req.headers.authorization);
    if (!token) {
      throw new AppError("Missing access token.", 401, "AUTH_REQUIRED");
    }
    const payload = verifyAccessToken(token);
    req.auth = {
      userId: payload.sub,
      maxUserId: payload.maxUserId,
      role: payload.role
    };
    next();
  } catch {
    next(new AppError("Invalid or expired access token.", 401, "AUTH_INVALID"));
  }
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) {
      return next(new AppError("Missing authenticated context.", 401, "AUTH_REQUIRED"));
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return next(new AppError("Forbidden.", 403, "FORBIDDEN"));
    }
    return next();
  };
}
