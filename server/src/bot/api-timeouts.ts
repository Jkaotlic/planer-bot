import type { Bot } from "grammy";

export interface ApiTimeouts {
  /** Срок любого вызова, кроме `getUpdates`. */
  callMs: number;
  /** Запас сверх long-poll `timeout` у `getUpdates`: Telegram вправе держать его столько. */
  pollGraceMs: number;
}

/**
 * 20 с, а не 500 по умолчанию grammY. Нажатия бот обрабатывает строго по одному
 * (`handleUpdates` в grammY ждёт каждое), поэтому зависший вызов на keep-alive
 * соединении, которое роутер тихо убил, держал очередь всей команды — кнопки
 * «переставали работать» минут на восемь и отходили сами. Ответ на кнопку
 * Telegram и так не принимает позже ~15 с, ждать дольше незачем.
 */
export const DEFAULT_API_TIMEOUTS: ApiTimeouts = { callMs: 20_000, pollGraceMs: 15_000 };

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
    const ms = method === "getUpdates" ? pollSeconds * 1000 + timeouts.pollGraceMs : timeouts.callMs;
    const deadline = AbortSignal.timeout(ms);
    // grammY описывает сигнал типом из полифила `abort-controller`; в рантайме это
    // обычный AbortSignal Node, отсюда приведение в обе стороны.
    type GrammySignal = Parameters<typeof prev>[2];
    const combined = signal ? AbortSignal.any([signal as unknown as AbortSignal, deadline]) : deadline;
    return prev(method, payload, combined as unknown as GrammySignal);
  });
}
