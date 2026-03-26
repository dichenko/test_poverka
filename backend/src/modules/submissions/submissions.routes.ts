import { Router } from "express";
import { validate } from "../../common/validate";
import { requireAuth } from "../../middlewares/auth";
import { logAuditEvent } from "../../services/audit.service";
import {
  confirmSubmissionParamsSchema,
  createDraftSubmissionSchema,
  listSubmissionsQuerySchema
} from "./submissions.schemas";
import { confirmSubmission, createDraftSubmission, listMySubmissions } from "./submissions.service";

const router = Router();

router.use(requireAuth);

router.post("/submissions/draft", validate(createDraftSubmissionSchema), async (req, res, next) => {
  try {
    const submission = await createDraftSubmission({
      userId: req.auth!.userId,
      meterNumber: req.body.meterNumber,
      currentValue: req.body.currentValue
    });

    await logAuditEvent({
      actorUserId: req.auth!.userId,
      action: "submission.created.pending_confirmation",
      entityType: "SUBMISSION",
      entityId: submission.id,
      meta: {
        meterNumber: submission.meterNumber,
        currentValue: submission.currentValue.toString()
      },
      req
    });

    return res.status(201).json({
      ok: true,
      submission: {
        id: submission.id,
        meterNumber: submission.meterNumber,
        currentValue: submission.currentValue.toString(),
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
        meterNumber: item.meterNumber,
        currentValue: item.currentValue.toString(),
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
