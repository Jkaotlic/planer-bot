import { and, asc, eq, lte } from "drizzle-orm";
import { GrammyError, InlineKeyboard, type Bot } from "grammy";
import type { InlineKeyboardMarkup } from "grammy/types";
import type { Db } from "../db/client";
import { foodCloseMessages, foodOrderPayments } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { isPermanentSendFailure } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";

type Scope = typeof foodCloseMessages.$inferSelect.scope;
export type FoodCloseReason = "closed" | "cancelled";
export type FoodCloseMessage = { employeeId: number; telegramUserId: number } & (
  { messageId: number; body?: never; keyboard?: never; paymentOrderId?: never } |
  { body: string; keyboard?: InlineKeyboardMarkup; paymentOrderId?: number; messageId?: never }
);

const RETRY_MS = 5 * 60_000;
const TICK_BATCH = 100;

export function queueFoodCloseMessages(db: Db, scope: Scope, messages: readonly FoodCloseMessage[]): void {
  for (const message of messages) db.insert(foodCloseMessages).values({ scope, ...message }).run();
}

/** Срочная рассылка забирает только свой заказ или опрос, тик подбирает остальные. */
export async function deliverFoodCloseMessages(db: Db, bot: Bot, scope?: Scope): Promise<void> {
  const pending = db.select({ id: foodCloseMessages.id }).from(foodCloseMessages)
    .where(and(scope == null ? undefined : eq(foodCloseMessages.scope, scope), lte(foodCloseMessages.nextAttemptAt, Date.now())))
    .orderBy(asc(foodCloseMessages.id))
    .limit(scope == null ? TICK_BATCH : -1)
    .all();
  for (const { id } of pending) {
    const now = Date.now();
    // Сдвигаем срок ДО запроса: тик и ручное закрытие могут проснуться вместе.
    // Если процесс остановился посреди отправки, запись восстановится по сроку.
    const message = db.update(foodCloseMessages).set({ nextAttemptAt: now + RETRY_MS })
      .where(and(eq(foodCloseMessages.id, id), lte(foodCloseMessages.nextAttemptAt, now)))
      .returning().get();
    if (!message) continue;
    const recipient = getEmployeeById(db, message.employeeId);
    const alreadyPaid = message.paymentOrderId != null && db.select({ id: foodOrderPayments.id }).from(foodOrderPayments)
      .where(and(eq(foodOrderPayments.orderId, message.paymentOrderId), eq(foodOrderPayments.employeeId, message.employeeId)))
      .get() != null;
    if (!recipient?.isActive || recipient.telegramUserId !== message.telegramUserId || alreadyPaid) {
      db.delete(foodCloseMessages).where(eq(foodCloseMessages.id, id)).run();
      continue;
    }
    try {
      if (message.messageId != null) {
        await bot.api.editMessageReplyMarkup(message.telegramUserId, message.messageId, { reply_markup: new InlineKeyboard() });
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
      console.warn(`food result delivery ${id} refused:`, safeErrorMessage(error));
    }
    db.delete(foodCloseMessages).where(eq(foodCloseMessages.id, id)).run();
  }
}
