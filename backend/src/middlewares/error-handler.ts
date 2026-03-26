import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { AppError } from "../common/app-error";
import { logger } from "../common/logger";

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({
    ok: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found."
    }
  });
}

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid request payload.",
        details: error.flatten()
      }
    });
  }

  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    });
  }

  logger.error(
    {
      err: error,
      path: req.path,
      method: req.method
    },
    "Unhandled error"
  );

  return res.status(500).json({
    ok: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Internal server error."
    }
  });
}
