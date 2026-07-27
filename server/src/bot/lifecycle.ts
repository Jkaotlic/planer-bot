import type { Bot } from "grammy";
import { safeErrorMessage } from "../util/safe-error";

export async function stopBotSafely(bot: Pick<Bot, "stop">): Promise<void> {
  try {
    await bot.stop();
  } catch (error) {
    console.error("bot failed to stop:", safeErrorMessage(error));
  }
}

export interface ShutdownDeps {
  bot: Pick<Bot, "stop">;
  closeHttp(): Promise<void>;
  closeDb(): void;
  exit(code: number): void;
}

/** Gracefully releases every long-lived resource, then actually terminates Node. */
export async function shutdownSafely(deps: ShutdownDeps): Promise<void> {
  let exitCode = 0;
  await stopBotSafely(deps.bot);
  try {
    await deps.closeHttp();
  } catch (error) {
    exitCode = 1;
    console.error("http server failed to stop:", safeErrorMessage(error));
  }
  try {
    deps.closeDb();
  } catch (error) {
    exitCode = 1;
    console.error("database failed to close:", safeErrorMessage(error));
  }
  deps.exit(exitCode);
}
