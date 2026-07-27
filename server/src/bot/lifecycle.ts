import type { Bot } from "grammy";
import { safeErrorMessage } from "../util/safe-error";

export async function stopBotSafely(bot: Pick<Bot, "stop">): Promise<void> {
  try {
    await bot.stop();
  } catch (error) {
    console.error("bot failed to stop:", safeErrorMessage(error));
  }
}
