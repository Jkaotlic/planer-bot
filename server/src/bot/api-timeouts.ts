import type { Bot } from "grammy";

export interface ApiTimeouts {
  /** Срок любого вызова, кроме `getUpdates`. */
  callMs: number;
  /** Запас сверх long-poll `timeout` у `getUpdates`: Telegram вправе держать его столько. */
  pollGraceMs: number;
  /**
   * Срок `sendDocument`. Файл инструкции чек-листа уходит с диска один раз, и
   * на медленном канале 20 с могло не хватить — тик повторял бы его вечно. Это
   * путь тика, а не кнопки: очередь нажатий он не держит.
   */
  uploadMs: number;
}

/**
 * 20 с, а не 500 по умолчанию grammY. Нажатия бот обрабатывает строго по одному
 * (`handleUpdates` в grammY ждёт каждое), поэтому зависший вызов на keep-alive
 * соединении, которое роутер тихо убил, держал очередь всей команды — кнопки
 * «переставали работать» минут на восемь и отходили сами. Ответ на кнопку
 * Telegram и так не принимает позже ~15 с, ждать дольше незачем.
 */
export const DEFAULT_API_TIMEOUTS: ApiTimeouts = { callMs: 20_000, pollGraceMs: 15_000, uploadMs: 120_000 };

/**
 * Свой срок на каждый вызов — через перехватчик, а не `client.timeoutSeconds`:
 * тот общий на все методы, а `getUpdates` обязан жить дольше своего long-poll
 * `timeout`, иначе опрос рвался бы на каждом круге. Отказ по сроку grammY
 * превращает в `HttpError`: у опроса это штатный повтор через 3 с, у кнопки —
 * ошибка обработчика, которую ловит `bot.catch`.
 */
export function installApiTimeouts(bot: Bot, timeouts: ApiTimeouts): void {
  bot.api.config.use((prev, method, payload, signal) => {
    const pollSeconds = method === "getUpdates" ? ((payload as { timeout?: number }).timeout ?? 0) : 0;
    const ms =
      method === "getUpdates" ? pollSeconds * 1000 + timeouts.pollGraceMs
      : method === "sendDocument" ? timeouts.uploadMs
      : timeouts.callMs;
    // Свой контроллер и подписка руками, а не `AbortSignal.any`: grammY передаёт
    // сигнал из полифила `abort-controller`, и `any` его отмену не видит — так
    // `bot.stop()` переставал прерывать висящий опрос. `addEventListener`
    // понимает любой сигнал.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    const onOuterAbort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener("abort", onOuterAbort);
    type GrammySignal = Parameters<typeof prev>[2];
    return prev(method, payload, controller.signal as unknown as GrammySignal).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onOuterAbort);
    });
  });
}
