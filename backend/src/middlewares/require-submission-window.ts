import type { NextFunction, Request, Response } from "express";
import { isSubmissionWindowOpen } from "../services/submission-window.service";

export function requireSubmissionWindow(req: Request, res: Response, next: NextFunction) {
  if (isSubmissionWindowOpen()) {
    return next();
  }

  return res.status(403).json({
    ok: false,
    error_code: "SUBMISSION_WINDOW_CLOSED",
    error: "Submission window is closed. Data can be sent only from 00:01 to 21:59 MSK."
  });
}
