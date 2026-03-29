import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/validate";
import { requireAuth } from "../../middlewares/auth";
import { authRateLimit } from "../../middlewares/rate-limit";
import { prisma } from "../../common/prisma";
import { createAuthSession, revokeRefreshToken, rotateRefreshToken } from "./auth.service";
import { verifyMaxInitData } from "./max-init-data";

const handshakeSchema = z.object({
  initData: z.string().min(10)
});

function kopecksToLegacyRubles(value: bigint | null | undefined) {
  if (value == null) {
    return null;
  }
  return Number(value) / 100;
}

const router = Router();

router.post("/auth/max/handshake", authRateLimit, validate(handshakeSchema), async (req, res, next) => {
  try {
    const validated = verifyMaxInitData(req.body.initData);
    const payload = await createAuthSession({ validated, req, res });
    res.json({ ok: true, ...payload });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/refresh", authRateLimit, async (req, res, next) => {
  try {
    const payload = await rotateRefreshToken(req, res);
    res.json({ ok: true, ...payload });
  } catch (error) {
    next(error);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    await revokeRefreshToken(req, res);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get("/auth/me", requireAuth, async (req, res, next) => {
  try {
    const userId = BigInt(req.auth!.userId);
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { organization: true }
    });
    if (!user) {
      return res.status(404).json({
        ok: false,
        error: {
          code: "USER_NOT_FOUND",
          message: "User not found."
        }
      });
    }
    return res.json({
      ok: true,
      user: {
        id: user.id.toString(),
        maxUserId: user.id.toString(),
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId?.toString() ?? null,
        organizationName: user.organization?.name ?? null,
        organizationBalance: user.organization?.balance ?? kopecksToLegacyRubles(user.organization?.balanceKopecks) ?? null,
        organizationTarif:
          user.organization?.userTarif ?? kopecksToLegacyRubles(user.organization?.tariffPerPackageKopecks) ?? null,
        organizationBalanceKopecks: user.organization?.balanceKopecks?.toString() ?? null,
        organizationTariffPerPackageKopecks: user.organization?.tariffPerPackageKopecks?.toString() ?? null
      }
    });
  } catch (error) {
    next(error);
  }
});

export { router as authRoutes };
