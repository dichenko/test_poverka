import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { AppError } from "../../common/app-error";
import { prisma } from "../../common/prisma";
import { validate } from "../../common/validate";
import { requireAuth } from "../../middlewares/auth";
import { requireSubmissionWindow } from "../../middlewares/require-submission-window";
import { logAuditEvent } from "../../services/audit.service";
import { getSubmissionWindowStatus } from "../../services/submission-window.service";
import { MAX_ADMIN_HELP_TEXT } from "../bot/admin-help-text";
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
const MAX_CONFIRMATION_RETRIES = 3;
const MAX_CONFIRMATION_RETRY_DELAY_MS = 1000;

router.use("/submissions", requireAuth);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function formatDateTimeMsk(value: Date) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(value);
}

function buildMaxDeliveryFailureMessage(maxUserId: string) {
  const datetime = formatDateTimeMsk(new Date());
  return `Заявка не отправлена - проблема с сетевым подключением. Закройте форму, отправьте в бот команду /start и заполните заявку заново.\nИнформация для техподдержки: max_id ${maxUserId} datetime ${datetime}`;
}

async function sendMessageWithRetry(payload: {
  userId: string;
  text: string;
  attachments?: Array<Record<string, any>>;
}) {
  let result: Awaited<ReturnType<typeof maxBotClient.sendMessage>> = { ok: false };

  for (let attempt = 0; attempt <= MAX_CONFIRMATION_RETRIES; attempt += 1) {
    result = await maxBotClient.sendMessage(payload);
    if (result.ok) {
      return result;
    }

    if (attempt < MAX_CONFIRMATION_RETRIES) {
      await sleep(MAX_CONFIRMATION_RETRY_DELAY_MS);
    }
  }

  return result;
}

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

async function handleCreateDraft(req: Request, res: Response, next: NextFunction) {
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

    const sent = await sendMessageWithRetry({
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
      throw new AppError(buildMaxDeliveryFailureMessage(req.auth!.userId), 502, "MAX_MESSAGE_SEND_FAILED");
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
}

router.get("/submissions/equipment-types", async (req, res, next) => {
  try {
    await assertNoActiveTopupForUser(req.auth!.userId);
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

router.post("/submissions/draft", requireSubmissionWindow, validate(createDraftSubmissionSchema), handleCreateDraft);

router.post("/miniapp/submit", requireAuth, requireSubmissionWindow, validate(createDraftSubmissionSchema), handleCreateDraft);

router.get("/miniapp/access", requireAuth, async (req, res, next) => {
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
      employee: {
        id: user.id.toString(),
        maxUserId: user.id.toString(),
        fullName: user.fullName,
        role: user.role,
        organizationId: user.organizationId?.toString() ?? null,
        organizationName: user.organization?.name ?? null,
        organizationBalance: user.organization?.balance?.toString() ?? null,
        organizationTarif: user.organization?.userTarif?.toString() ?? null,
        adminHelpText: user.role === "ADMIN" ? MAX_ADMIN_HELP_TEXT : null
      },
      submission_window: getSubmissionWindowStatus()
    });
  } catch (error) {
    return next(error);
  }
});

router.post("/submissions/:id/confirm", requireSubmissionWindow, validate(confirmSubmissionParamsSchema, "params"), async (req, res, next) => {
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
