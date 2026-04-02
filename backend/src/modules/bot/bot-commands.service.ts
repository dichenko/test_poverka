import { logger } from "../../common/logger";
import { maxBotClient } from "./max-bot.client";

const MAX_BOT_COMMANDS = [
  {
    name: "start",
    description: "\u0417\u0430\u043f\u0443\u0441\u0442\u0438\u0442\u044c \u0431\u043e\u0442\u0430"
  }
];

export async function syncMaxBotCommandsOnStartup() {
  const result = await maxBotClient.setMyCommands(MAX_BOT_COMMANDS);
  if (!result.ok) {
    logger.warn(
      { status: result.status, body: result.body, commands: MAX_BOT_COMMANDS },
      "MAX bot commands sync failed on startup"
    );
    return;
  }

  logger.info({ commands: MAX_BOT_COMMANDS }, "MAX bot commands synced on startup");
}
