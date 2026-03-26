import { env } from "../../config/env";
import { logger } from "../../common/logger";

interface SendMessagePayload {
  userId: string;
  text: string;
  miniappUrl?: string;
}

export class MaxBotClient {
  async sendMessage(payload: SendMessagePayload) {
    const body = {
      user_id: payload.userId,
      text: payload.text,
      web_app: payload.miniappUrl
        ? {
            url: payload.miniappUrl,
            label: "Открыть миниапп"
          }
        : undefined
    };

    try {
      const response = await fetch(`${env.MAX_BOT_API_BASE_URL}/messages/send`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.MAX_BOT_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const text = await response.text();
        logger.error({ status: response.status, body: text }, "Failed to send MAX message");
      }
    } catch (error) {
      logger.error({ err: error }, "MAX sendMessage failed");
    }
  }
}

export const maxBotClient = new MaxBotClient();
