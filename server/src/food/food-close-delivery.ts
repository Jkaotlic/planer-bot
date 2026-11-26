import { and, asc, eq, lte, notExists } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import { GrammyError, InlineKeyboard, type Bot } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { Db } from "../db/client";
import { foodCloseMessages, foodOrderPayments } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { isPermanentSendFailure } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import { freezeTelegramPollResult, getPoll, hasTelegramPollFinalState, isTelegramPollSending, recordTelegramPollState } from "../polls/poll-service";

type Scope = typeof foodCloseMessages.$inferSelect.scope;
export type FoodCloseReason = "closed" | "cancelled";
export type FoodCloseMessage = { employeeId: number; telegramUserId: number } & (
  { messageId: number; stopPoll?: boolean; body?: never; keyboard?: never; paymentOrderId?: never; nativePollSummary?: never } |
  { body: string; keyboard?: InlineKeyboardMarkup; paymentOrderId?: number; messageId?: never; stopPoll?: never; nativePollSummary?: never } |
  { nativePollSummary: true; body?: never; keyboard?: never; paymentOrderId?: never; messageId?: never; stopPoll?: never }
);

const RETRY_MS = 5 * 60_000;
const TICK_BATCH = 100;

export function queueFoodCloseMessages(db: Db, scope: Scope, messages: readonly FoodCloseMessage[]): void {
  for (const message of messages) db.insert(foodCloseMessages).values({ scope, ...message }).run();
}

/** Срочная рассылка забирает только свой заказ или опрос, тик подбирает остальные. */
export async function deliverFoodCloseMessages(db: Db, bot: Bot, scope?: Scope): Promise<void> {
  await deliverReadyMessages(db, bot, scope, false);
  await deliverReadyMessages(db, bot, scope, true);
}

async function deliverReadyMessages(db: Db, bot: Bot, scope: Scope | undefined, nativePollSummary: boolean): Promise<void> {
  const stopJob = alias(foodCloseMessages, "stop_job");
  // Итог считаем после завершения всех stopPoll: Telegram может прислать
  // окончательный голос в ответе на остановку, а не отдельным обновлением.
  const ready = nativePollSummary ? notExists(db.select({ id: stopJob.id }).from(stopJob)
    .where(and(eq(stopJob.scope, foodCloseMessages.scope), eq(stopJob.stopPoll, true)))) : undefined;
  const pending = db.select({ id: foodCloseMessages.id, scope: foodCloseMessages.scope }).from(foodCloseMessages)
    .where(and(
      scope == null ? undefined : eq(foodCloseMessages.scope, scope),
      eq(foodCloseMessages.nativePollSummary, nativePollSummary), lte(foodCloseMessages.nextAttemptAt, Date.now()), ready,
    ))
    .orderBy(asc(foodCloseMessages.id))
    .limit(scope == null ? TICK_BATCH : -1)
    .all();
  for (const { id, scope: messageScope } of pending) {
    // У карточки в полёте ещё нет ID в базе. Останавливать уже известные
    // карточки можно сразу, а общий итог дождётся последнего ответа sendPoll.
    if (nativePollSummary && isTelegramPollSending(db, Number(messageScope.slice("poll:".length)))) continue;
    const now = Date.now();
    // Сдвигаем срок ДО запроса: тик и ручное закрытие могут проснуться вместе.
    // Если процесс остановился посреди отправки, запись восстановится по сроку.
    const message = db.update(foodCloseMessages).set({ nextAttemptAt: now + RETRY_MS })
      .where(and(eq(foodCloseMessages.id, id), lte(foodCloseMessages.nextAttemptAt, now), ready))
      .returning().get();
    if (!message) continue;
    if (message.awaitingPollSnapshot) {
      // Telegram уже подтвердил закрытие. По истечении интервала не держим
      // всю рассылку: без обновления итог будет помечен предварительным.
      db.delete(foodCloseMessages).where(eq(foodCloseMessages.id, id)).run();
      continue;
    }
    const recipient = getEmployeeById(db, message.employeeId);
    const alreadyPaid = message.paymentOrderId != null && db.select({ id: foodOrderPayments.id }).from(foodOrderPayments)
      .where(and(eq(foodOrderPayments.orderId, message.paymentOrderId), eq(foodOrderPayments.employeeId, message.employeeId)))
      .get() != null;
    // Снять голосование надо и со старой личной карточки после отвязки
    // аккаунта. stopPoll правит только уже отправленную ботом карточку.
    if (!message.stopPoll && (!recipient?.isActive || recipient.telegramUserId !== message.telegramUserId || alreadyPaid)) {
      db.delete(foodCloseMessages).where(eq(foodCloseMessages.id, id)).run();
      continue;
    }
    try {
      if (message.messageId != null) {
        if (message.stopPoll) {
          const result = await bot.api.stopPoll(message.telegramUserId, message.messageId, { reply_markup: { inline_keyboard: [] } });
          if (result?.is_closed && Array.isArray(result.options)) recordTelegramPollState(db, result);
        } else {
          await bot.api.editMessageReplyMarkup(message.telegramUserId, message.messageId, { reply_markup: new InlineKeyboard() });
        }
      } else if (message.nativePollSummary && message.scope.startsWith("poll:")) {
        const summary = freezeTelegramPollResult(db, Number(message.scope.slice("poll:".length)));
        if (summary != null) await bot.api.sendMessage(message.telegramUserId, summary, { protect_content: true });
      } else if (message.body != null) {
        await bot.api.sendMessage(message.telegramUserId, message.body, message.keyboard ? { reply_markup: message.keyboard } : undefined);
      }
    } catch (error) {
      if (!isPermanentSendFailure(error)) {
        const retryAfter = error instanceof GrammyError ? error.parameters.retry_after ?? 0 : 0;
        if (retryAfter > 0) {
          const retryAt = Math.max(message.nextAttemptAt, Date.now() + retryAfter * 1000);
          db.update(foodCloseMessages).set({ nextAttemptAt: retryAt }).where(eq(foodCloseMessages.id, id)).run();
        }
        console.warn(`food result delivery ${id} will retry:`, safeErrorMessage(error));
        continue;
      }
      const alreadyClosed = message.stopPoll && error instanceof GrammyError
        && /already[_ ]+closed|already been closed/i.test(error.description);
      if (alreadyClosed) {
        // На естественном закрытии ответ stopPoll может обогнать обновление
        // poll. Дадим боту один интервал, чтобы получить точные результаты.
        const poll = getPoll(db, Number(message.scope.slice("poll:".length)));
        if (!poll?.telegramManualClosed && message.messageId != null
            && !hasTelegramPollFinalState(db, message.telegramUserId, message.messageId)) {
          db.update(foodCloseMessages).set({ awaitingPollSnapshot: true }).where(eq(foodCloseMessages.id, id)).run();
          continue;
        }
      } else {
        console.warn(`food result delivery ${id} refused:`, safeErrorMessage(error));
      }
    }
    db.delete(foodCloseMessages).where(eq(foodCloseMessages.id, id)).run();
  }
}
