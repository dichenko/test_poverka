import { Router } from "express";
import { prisma } from "../../common/prisma";

const router = Router();

router.get("/health/live", (_req, res) => {
  res.json({ ok: true, status: "live" });
});

router.get("/health/ready", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, status: "ready" });
  } catch {
    res.status(503).json({ ok: false, status: "not_ready" });
  }
});

router.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export { router as healthRoutes };
