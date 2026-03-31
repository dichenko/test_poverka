import { Router } from "express";
import { AppError } from "../../common/app-error";
import { validate } from "../../common/validate";
import { requireAuth } from "../../middlewares/auth";
import { logAuditEvent } from "../../services/audit.service";
import { maxBotClient } from "../bot/max-bot.client";
import { submissionReviewMessage } from "../bot/bot.templates";
import { assertNoActiveTopupForUser } from "../payments/topups.service";
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

router.use("/submissions", requireAuth);

function reviewKeyboard(submissionId: string) {
  return [
    {
      type: "inline_keyboard",
      payload: {
        buttons: [
          [
            {
              type: "message",
              text: "Подтвердить",
              payload: `confirm_submission:${submissionId}`
            },
            {
              type: "message",
              text: "Отменить",
              payload: `cancel_submission:${submissionId}`
            }
          ]
        ]
      }
    }
  ];
}

function resolveEquipmentTypeName(input: {
  equipmentType: { name: string } | null;
  customEquipmentTypeName: string | null;
}) {
  return input.equipmentType?.name ?? input.customEquipmentTypeName ?? null;
}

router.get("/submissions/equipment-types", async (_req, res, next) => {
  try {
    await assertNoActiveTopupForUser(_req.auth!.userId);
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
    await assertNoActiveTopupForUser(req.auth!.userId);
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
            customEquipmentTypeName: submission.customEquipmentTypeName,
            equipmentTypeName: resolveEquipmentTypeName(submission),
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
    await assertNoActiveTopupForUser(req.auth!.userId);
    const submission = await createDraftSubmission({
      userId: req.auth!.userId,
      address: req.body.address,
      phone: req.body.phone,
      waterType: req.body.waterType,
      equipmentTypeId: req.body.equipmentTypeId,
      customEquipmentTypeName: req.body.customEquipmentTypeName,
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
        customEquipmentTypeName: submission.customEquipmentTypeName,
        factoryNumber: submission.meterNumber,
        productionYear: submission.productionYear,
        reading: submission.currentValue.toString()
      },
      req
    });

    const sent = await maxBotClient.sendMessage({
      userId: req.auth!.userId,
      text: submissionReviewMessage({
        address: submission.address,
        phone: submission.phone,
        waterType: submission.waterType,
        equipmentTypeName: resolveEquipmentTypeName(submission),
        factoryNumber: submission.meterNumber,
        productionYear: submission.productionYear,
        reading: submission.currentValue.toString()
      }),
      attachments: reviewKeyboard(submission.id)
    });

    if (!sent.ok) {
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
        customEquipmentTypeName: submission.customEquipmentTypeName,
        equipmentTypeName: resolveEquipmentTypeName(submission),
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
    await assertNoActiveTopupForUser(req.auth!.userId);
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
        customEquipmentTypeName: item.customEquipmentTypeName,
        equipmentTypeName: resolveEquipmentTypeName(item),
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
