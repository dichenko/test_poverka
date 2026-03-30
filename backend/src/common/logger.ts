import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-max-bot-api-secret"
    ],
    censor: "[REDACTED]"
  }
});
