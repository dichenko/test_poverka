import { env } from "../../config/env";
import { logger } from "../../common/logger";

interface SendMessagePayload {
  userId: string;
  text: string;
  miniappUrl?: string;
}

export class MaxBotClient {
  async sendMessage(payload: SendMessagePayload) {
    const endpoint = new URL("/messages", env.MAX_BOT_API_BASE_URL);
    endpoint.searchParams.set("user_id", payload.userId);

    const text = payload.miniappUrl ? `${payload.text}\n\n${payload.miniappUrl}` : payload.text;
    const body = {
      text,
      attachments: []
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
      }
    } catch (error) {
      logger.error({ err: error, userId: payload.userId, endpoint: endpoint.toString() }, "MAX sendMessage failed");
    }
  }
}

export const maxBotClient = new MaxBotClient();
