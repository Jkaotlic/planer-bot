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
  /**
   * Отправить то, что ждёт в буферах (письма об изменениях графика копятся по
   * минуте). После `closeHttp` — новых правок уже не будет; до `closeDb` —
   * буфер пишет журнал. `bot.stop()` останавливает только опрос: отправка
   * через API работает и после него.
   */
  flushPending?(): Promise<void>;
  /** Сколько ждать `flushPending`: зависший Telegram не должен держить рестарт. */
  flushTimeoutMs?: number;
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
  if (deps.flushPending) {
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, deps.flushTimeoutMs ?? 5000).unref?.());
    try {
      await Promise.race([deps.flushPending(), timeout]);
    } catch (error) {
      console.error("pending notices failed to flush:", safeErrorMessage(error));
    }
  }
  try {
    deps.closeDb();
  } catch (error) {
    exitCode = 1;
    console.error("database failed to close:", safeErrorMessage(error));
  }
  deps.exit(exitCode);
}
