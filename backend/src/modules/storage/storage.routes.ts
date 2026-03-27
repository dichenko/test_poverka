import { Router } from "express";
import multer from "multer";
import { prisma } from "../../common/prisma";
import { requireAuth } from "../../middlewares/auth";
import { logAuditEvent } from "../../services/audit.service";
import { getStorageProvider } from "./storage.service";

const upload = multer({ storage: multer.memoryStorage() });
const router = Router();

router.use(requireAuth);

router.post("/files/upload", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        ok: false,
        error: {
          code: "FILE_REQUIRED",
          message: "file is required."
        }
      });
    }

    const actorUserId = BigInt(req.auth!.userId);

    const provider = getStorageProvider();
    const stored = await provider.saveFile({
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype
    });

    const file = await prisma.fileEntity.create({
      data: {
        ownerUserId: actorUserId,
        storageKey: stored.storageKey,
        originalName: stored.originalName,
        mimeType: stored.mimeType,
        sizeBytes: stored.sizeBytes,
        publicUrl: stored.publicUrl
      }
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "file.uploaded",
      entityType: "FILE",
      entityId: file.id,
      meta: { mimeType: file.mimeType, sizeBytes: file.sizeBytes },
      req
    });

    return res.status(201).json({ ok: true, file });
  } catch (error) {
    return next(error);
  }
});

export { router as storageRoutes };
