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

export class MaxBotClient {
  async sendMessage(payload: SendMessagePayload): Promise<SendMessageResult> {
    const endpoint = new URL("/messages", env.MAX_BOT_API_BASE_URL);
    endpoint.searchParams.set("user_id", payload.userId);

    const text = payload.miniappUrl ? `${payload.text}\n\n${payload.miniappUrl}` : payload.text;
    const body = {
      text,
      attachments: payload.attachments ?? [],
      format: payload.format
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: env.MAX_BOT_TOKEN,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const responseBody = await response.text();
        logger.error(
          { status: response.status, body: responseBody, userId: payload.userId, endpoint: endpoint.toString() },
          "Failed to send MAX message"
        );
        return { ok: false, status: response.status, body: responseBody };
      }
      return { ok: true, status: response.status };
    } catch (error) {
      logger.error({ err: error, userId: payload.userId, endpoint: endpoint.toString() }, "MAX sendMessage failed");
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
