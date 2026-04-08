import fs from "fs/promises";
import path from "path";
import { env } from "../../config/env";
import { logger } from "../../common/logger";

interface SendMessagePayload {
  userId: string;
  text: string;
  miniappUrl?: string;
  attachments?: Array<Record<string, any>>;
  format?: "markdown" | "html";
}

interface SendMessageResult {
  ok: boolean;
  status?: number;
  body?: string;
}

interface SendFileMessagePayload {
  userId: string;
  filePath: string;
  fileName?: string;
  text?: string;
  format?: "markdown" | "html";
}

interface GetMessageResult {
  ok: boolean;
  status?: number;
  body?: string;
  message?: any;
}

interface AnswerCallbackPayload {
  callbackId: string;
  notification?: string;
  message?: {
    text?: string;
    attachments?: Array<Record<string, any>>;
  };
}

export interface MaxBotCommand {
  name: string;
  description?: string | null;
}

interface SetMyCommandsResult {
  ok: boolean;
  status?: number;
  body?: string;
}

const MAX_PLATFORM_API_BASE_URL = "https://platform-api.max.ru";
const ATTACHMENT_NOT_READY_CODE = "attachment.not.ready";
const FILE_ATTACHMENT_SEND_RETRY_DELAYS_MS = [1000, 2000, 4000];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAttachmentNotReadyError(bodyRaw: string | undefined) {
  if (!bodyRaw) {
    return false;
  }

  if (bodyRaw.includes(ATTACHMENT_NOT_READY_CODE)) {
    return true;
  }

  try {
    const parsed = JSON.parse(bodyRaw) as { code?: string };
    return parsed.code === ATTACHMENT_NOT_READY_CODE;
  } catch {
    return false;
  }
}

export class MaxBotClient {
  private async sendMessageRequest(input: { userId: string; body: Record<string, unknown> }): Promise<SendMessageResult> {
    const endpoint = new URL("/messages", env.MAX_BOT_API_BASE_URL);
    endpoint.searchParams.set("user_id", input.userId);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: env.MAX_BOT_TOKEN,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input.body)
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger.error(
        { status: response.status, body: responseBody, userId: input.userId, endpoint: endpoint.toString() },
        "Failed to send MAX message"
      );
      return { ok: false, status: response.status, body: responseBody };
    }

    return { ok: true, status: response.status };
  }

  private async requestUploadUrl(uploadType: "file") {
    const endpoint = new URL("/uploads", env.MAX_BOT_API_BASE_URL);
    endpoint.searchParams.set("type", uploadType);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: env.MAX_BOT_TOKEN
      }
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger.error(
        { status: response.status, body: responseBody, endpoint: endpoint.toString(), uploadType },
        "Failed to request MAX upload URL"
      );
      return null;
    }

    const body = (await response.json().catch(() => null)) as { url?: string } | null;
    if (!body?.url) {
      logger.error({ endpoint: endpoint.toString(), uploadType }, "MAX upload URL response does not contain url");
      return null;
    }

    return body.url;
  }

  private async uploadFileByUrl(input: { uploadUrl: string; filePath: string; fileName: string }) {
    const buffer = await fs.readFile(input.filePath);
    const form = new FormData();
    form.append("data", new Blob([buffer], { type: "application/octet-stream" }), input.fileName);

    const response = await fetch(input.uploadUrl, {
      method: "POST",
      body: form
    });

    if (!response.ok) {
      const responseBody = await response.text();
      logger.error(
        { status: response.status, body: responseBody, uploadUrl: input.uploadUrl, fileName: input.fileName },
        "Failed to upload file to MAX media storage"
      );
      return null;
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;
    if (!payload || typeof payload !== "object") {
      logger.error({ uploadUrl: input.uploadUrl, fileName: input.fileName }, "Invalid MAX upload payload");
      return null;
    }

    return payload;
  }

  async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const text = payload.miniappUrl ? `${payload.text}\n\n${payload.miniappUrl}` : payload.text;
    const body = {
      text,
      attachments: payload.attachments ?? [],
      format: payload.format
    };

    try {
      return await this.sendMessageRequest({
        userId: payload.userId,
        body
      });
    } catch (error) {
      const endpoint = new URL("/messages", env.MAX_BOT_API_BASE_URL);
      logger.error({ err: error, userId: payload.userId, endpoint: endpoint.toString() }, "MAX sendMessage failed");
      return { ok: false };
    }
  }

  async sendFileMessage(payload: SendFileMessagePayload): Promise<SendMessageResult> {
    const fileName = (payload.fileName ?? path.basename(payload.filePath)).trim();
    if (!fileName) {
      logger.error({ filePath: payload.filePath }, "Cannot send file to MAX: empty fileName");
      return { ok: false };
    }

    try {
      const uploadUrl = await this.requestUploadUrl("file");
      if (!uploadUrl) {
        return { ok: false };
      }

      const filePayload = await this.uploadFileByUrl({
        uploadUrl,
        filePath: payload.filePath,
        fileName
      });
      if (!filePayload) {
        return { ok: false };
      }

      const body = {
        text: payload.text,
        attachments: [
          {
            type: "file",
            payload: filePayload
          }
        ],
        format: payload.format
      };

      for (let attempt = 0; attempt < FILE_ATTACHMENT_SEND_RETRY_DELAYS_MS.length + 1; attempt += 1) {
        const sent = await this.sendMessageRequest({
          userId: payload.userId,
          body
        });

        if (sent.ok) {
          return sent;
        }

        const retryDelayMs = FILE_ATTACHMENT_SEND_RETRY_DELAYS_MS[attempt];
        const isRetryable = isAttachmentNotReadyError(sent.body);
        if (!isRetryable || retryDelayMs === undefined) {
          return sent;
        }

        await sleep(retryDelayMs);
      }

      return { ok: false };
    } catch (error) {
      logger.error(
        {
          err: error,
          userId: payload.userId,
          filePath: payload.filePath
        },
        "MAX sendFileMessage failed"
      );
      return { ok: false };
    }
  }

  async getMessage(mid: string): Promise<GetMessageResult> {
    const endpoint = new URL(`/messages/${encodeURIComponent(mid)}`, env.MAX_BOT_API_BASE_URL);
    try {
      const response = await fetch(endpoint, {
        method: "GET",
        headers: {
          Authorization: env.MAX_BOT_TOKEN
        }
      });
      if (!response.ok) {
        const responseBody = await response.text();
        logger.error(
          { status: response.status, body: responseBody, mid, endpoint: endpoint.toString() },
          "Failed to get MAX message"
        );
        return { ok: false, status: response.status, body: responseBody };
      }
      const data: any = await response.json().catch(() => ({}));
      return { ok: true, status: response.status, message: data?.message ?? data };
    } catch (error) {
      logger.error({ err: error, mid, endpoint: endpoint.toString() }, "MAX getMessage failed");
      return { ok: false };
    }
  }

  async answerCallback(payload: AnswerCallbackPayload) {
    const endpoint = new URL("/answers", env.MAX_BOT_API_BASE_URL);
    endpoint.searchParams.set("callback_id", payload.callbackId);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: env.MAX_BOT_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          notification: payload.notification,
          message: payload.message
        })
      });

      if (!response.ok) {
        const responseBody = await response.text();
        logger.error(
          { status: response.status, body: responseBody, callbackId: payload.callbackId, endpoint: endpoint.toString() },
          "Failed to answer MAX callback"
        );
      }
    } catch (error) {
      logger.error({ err: error, callbackId: payload.callbackId, endpoint: endpoint.toString() }, "MAX answerCallback failed");
    }
  }

  async setMyCommands(commands: MaxBotCommand[]): Promise<SetMyCommandsResult> {
    const setCommandsByBaseUrl = async (baseUrl: string): Promise<SetMyCommandsResult> => {
      const endpoint = new URL("/me", baseUrl);

      try {
        const response = await fetch(endpoint, {
          method: "PATCH",
          headers: {
            Authorization: env.MAX_BOT_TOKEN,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ commands })
        });

        if (!response.ok) {
          const responseBody = await response.text();
          logger.error(
            { status: response.status, body: responseBody, endpoint: endpoint.toString(), commands },
            "Failed to set MAX bot commands"
          );
          return { ok: false, status: response.status, body: responseBody };
        }

        return { ok: true, status: response.status };
      } catch (error) {
        logger.error({ err: error, endpoint: endpoint.toString(), commands }, "MAX setMyCommands failed");
        return { ok: false };
      }
    };

    const primaryResult = await setCommandsByBaseUrl(env.MAX_BOT_API_BASE_URL);
    if (primaryResult.ok) {
      return primaryResult;
    }

    const primaryHost = new URL(env.MAX_BOT_API_BASE_URL).host;
    const fallbackHost = new URL(MAX_PLATFORM_API_BASE_URL).host;
    if (primaryHost === fallbackHost) {
      return primaryResult;
    }

    logger.warn(
      { primaryBaseUrl: env.MAX_BOT_API_BASE_URL, fallbackBaseUrl: MAX_PLATFORM_API_BASE_URL },
      "Retrying MAX bot commands sync via platform API base URL"
    );

    return setCommandsByBaseUrl(MAX_PLATFORM_API_BASE_URL);
  }
}

export const maxBotClient = new MaxBotClient();
