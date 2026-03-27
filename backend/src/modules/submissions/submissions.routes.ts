import { Router } from "express";
import { AppError } from "../../common/app-error";
import { env } from "../../config/env";
import { validate } from "../../common/validate";
import { requireAuth } from "../../middlewares/auth";
import { logAuditEvent } from "../../services/audit.service";
import { maxBotClient } from "../bot/max-bot.client";
import { submissionReviewMessage } from "../bot/bot.templates";
import {
  confirmSubmissionParamsSchema,
  createDraftSubmissionSchema,
  listSubmissionsQuerySchema
} from "./submissions.schemas";
import {
  confirmSubmission,
  createDraftSubmission,
  getLatestPendingSubmission,
  listEquipmentTypes,
  listMySubmissions
} from "./submissions.service";

const router = Router();

router.use(requireAuth);

function getOpenAppCandidates() {
  const candidates = new Set<string>();
  if (env.MAX_WEB_APP) {
    candidates.add(env.MAX_WEB_APP);
  }
  try {
    candidates.add(new URL(env.MINIAPP_PUBLIC_URL).host);
  } catch {
    // ignore invalid URL, validated in env schema anyway
  }
  candidates.add(env.MINIAPP_PUBLIC_URL);
  return [...candidates].filter(Boolean);
}

function buildReviewKeyboard(submissionId: string, editButton: Record<string, any>) {
  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "callback",
              text: "Подтвердить",
              payload: `confirm_submission:${submissionId}`
            },
            editButton
          ]
        ]
      }
    }
  ];
}

async function sendReviewMessage(input: {
  userId: string;
  submissionId: string;
  text: string;
}) {
  const openAppCandidates = getOpenAppCandidates();

  for (const candidate of openAppCandidates) {
    const result = await maxBotClient.sendMessage({
      userId: input.userId,
      text: input.text,
      attachments: buildReviewKeyboard(input.submissionId, {
        type: "open_app",
        text: "Редактировать",
        web_app: candidate
      })
    });
    if (result.ok) {
      return true;
    }
  }

  const fallback = await maxBotClient.sendMessage({
    userId: input.userId,
    text: `${input.text}\n\nЕсли кнопка «Редактировать» не открывает miniapp, используйте ссылку:\n${env.MINIAPP_PUBLIC_URL}`,
    attachments: buildReviewKeyboard(input.submissionId, {
      type: "link",
      text: "Редактировать",
      url: env.MINIAPP_PUBLIC_URL
    })
  });

  return fallback.ok;
}

router.get("/submissions/equipment-types", async (_req, res, next) => {
  try {
    const equipmentTypes = await listEquipmentTypes();
    return res.json({
      ok: true,
      equipmentTypes: equipmentTypes.map((item) => ({
        id: item.id,
        name: item.name
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/submissions/pending/latest", async (req, res, next) => {
  try {
    const submission = await getLatestPendingSubmission(req.auth!.userId);
    return res.json({
      ok: true,
      submission: submission
        ? {
            id: submission.id,
            address: submission.address,
            phone: submission.phone,
            waterType: submission.waterType,
            equipmentTypeId: submission.equipmentTypeId,
            equipmentTypeName: submission.equipmentType?.name ?? null,
            factoryNumber: submission.meterNumber,
            productionYear: submission.productionYear,
            reading: submission.currentValue.toString(),
            status: submission.status,
            createdAt: submission.createdAt
          }
        : null
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/submissions/draft", validate(createDraftSubmissionSchema), async (req, res, next) => {
  try {
    const submission = await createDraftSubmission({
      userId: req.auth!.userId,
      address: req.body.address,
      phone: req.body.phone,
      waterType: req.body.waterType,
      equipmentTypeId: req.body.equipmentTypeId,
      factoryNumber: req.body.factoryNumber,
      productionYear: req.body.productionYear,
      reading: req.body.reading
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "submission.created.pending_confirmation",
      entityType: "SUBMISSION",
      entityId: submission.id,
      meta: {
        address: submission.address,
        phone: submission.phone,
        waterType: submission.waterType,
        equipmentTypeId: submission.equipmentTypeId,
        factoryNumber: submission.meterNumber,
        productionYear: submission.productionYear,
        reading: submission.currentValue.toString()
      },
      req
    });

    const sent = await sendReviewMessage({
      userId: req.auth!.userId,
      submissionId: submission.id,
      text: submissionReviewMessage({
        address: submission.address,
        phone: submission.phone,
        waterType: submission.waterType,
        equipmentTypeName: submission.equipmentType?.name ?? null,
        factoryNumber: submission.meterNumber,
        productionYear: submission.productionYear,
        reading: submission.currentValue.toString()
      })
    });

    if (!sent) {
      throw new AppError("Failed to send confirmation message to MAX.", 502, "MAX_MESSAGE_SEND_FAILED");
    }

    return res.status(201).json({
      ok: true,
      submission: {
        id: submission.id,
        address: submission.address,
        phone: submission.phone,
        waterType: submission.waterType,
        equipmentTypeId: submission.equipmentTypeId,
        equipmentTypeName: submission.equipmentType?.name ?? null,
        factoryNumber: submission.meterNumber,
        productionYear: submission.productionYear,
        reading: submission.currentValue.toString(),
        status: submission.status,
        createdAt: submission.createdAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/submissions/:id/confirm", validate(confirmSubmissionParamsSchema, "params"), async (req, res, next) => {
  try {
    const params = confirmSubmissionParamsSchema.parse(req.params);
    const submission = await confirmSubmission({
      submissionId: params.id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "submission.confirmed",
      entityType: "SUBMISSION",
      entityId: submission.id,
      req
    });

    return res.json({
      ok: true,
      submission: {
        id: submission.id,
        status: submission.status,
        confirmedAt: submission.confirmedAt
      }
    });
  } catch (error) {
    return next(error);
  }
});

router.get("/submissions/me", validate(listSubmissionsQuerySchema, "query"), async (req, res, next) => {
  try {
    const query = listSubmissionsQuerySchema.parse(req.query);
    const submissions = await listMySubmissions({
      userId: req.auth!.userId,
      limit: query.limit,
      status: query.status
    });

    return res.json({
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
        createdAt: item.createdAt,
        confirmedAt: item.confirmedAt
      }))
    });
  } catch (error) {
    return next(error);
  }
});

export { router as submissionsRoutes };
