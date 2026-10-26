import { GrammyError, type Bot } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { safeErrorMessage } from "../util/safe-error";

export interface KeepPollingDeps {
  bot: Pick<Bot, "start">;
  onStart(info: UserFromGetMe): void;
  log(line: string): void;
  sleep(ms: number): Promise<void>;
  exit(code: number): void;
  /** Сколько отказов подряд терпим, прежде чем уронить процесс. */
  maxAttempts?: number;
}

/**
 * Срок одного круга long-poll — 10 с, а не 30 по умолчанию grammY.
 *
 * С 24.10.2026 путь до Telegram (зарубежный трафик идёт через туннель роутера)
 * рвёт сбросом любое TCP-соединение, по которому 20 с не прошло ни байта; замер
 * 26.10: молчащие соединения к api.telegram.org, к его второму адресу и даже к
 * SSH GitHub получали ECONNRESET ровно на 20-й секунде, а соединение, по которому
 * каждые 12 с шёл запрос, жило сколько угодно. Круг в 30 с умирал всегда, когда в
 * команде тихо: бот ловил нажатия только в щель между сбросами, а `/api/health`
 * ночами краснел на часы. 10 с — вдвое ниже порога и всё ещё один запрос на круг.
 */
export const POLL_TIMEOUT_S = 10;

/** 5, 10, 15 … 60 с: второй экземпляр при рестарте живёт секунды, ждать дольше незачем. */
function backoffMs(attempt: number): number {
  return Math.min(attempt * 5_000, 60_000);
}

/** 401 — токен отозван, 404 — токен кривой: повтор ничего не изменит. */
function isBadToken(error: unknown): boolean {
  return error instanceof GrammyError && (error.error_code === 401 || error.error_code === 404);
}

/**
 * Держит long-polling живым.
 *
 * grammY считает 409 фатальным: `bot.start()` отклоняется, и раньше на этом всё
 * заканчивалось — HTTP отвечал, `/api/health` был зелёным, launchd ничего не
 * замечал, а бот молчал до ручного рестарта (2026-09-07, один сторонний
 * `getUpdates` с тем же токеном). 409 транзиентен по природе, поэтому — повтор с
 * паузой. Если отказы идут подряд, лучше уронить процесс: launchd поднимет его
 * целиком, а живой процесс с мёртвым опросом не поднимет никто.
 *
 * Неверный токен — исключение: процесс остаётся жить ради HTTP (так работает
 * локальная разработка с токеном-заглушкой), а о боте говорит `/api/health`.
 */
export async function keepPolling(deps: KeepPollingDeps): Promise<void> {
  const maxAttempts = deps.maxAttempts ?? 10;
  let failures = 0;
  for (;;) {
    try {
      await deps.bot.start({
        timeout: POLL_TIMEOUT_S,
        onStart: (info) => {
          // Опрос пошёл — значит, предыдущие отказы кончились; следующий 409
          // через неделю не должен досчитывать до падения старые.
          failures = 0;
          deps.onStart(info);
        },
      });
      return; // `bot.stop()` при остановке процесса — штатный выход
    } catch (error) {
      if (isBadToken(error)) {
        deps.log(`bot failed to start (check BOT_TOKEN): ${safeErrorMessage(error)}`);
        return;
      }
      failures++;
      if (failures >= maxAttempts) {
        deps.log(`bot polling gave up after ${failures} failures, exiting: ${safeErrorMessage(error)}`);
        deps.exit(1);
        return;
      }
      const wait = backoffMs(failures);
      deps.log(`bot polling stopped (${failures}/${maxAttempts}), restart in ${wait / 1000}s: ${safeErrorMessage(error)}`);
      await deps.sleep(wait);
    }
  }
}
