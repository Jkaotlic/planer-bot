import type { Bot } from "grammy";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "../db/client";
import { employees } from "../db/schema";
import { safeErrorMessage } from "../util/safe-error";

/**
 * Запоминать, кто заблокировал бота, — в одном месте, а не в двадцати путях
 * отправки.
 *
 * Перехватчик API видит каждый вызов, и ответ 403 на вызов с `chat_id` — это
 * ответ про человека, а не про момент: он заблокировал бота или удалил
 * аккаунт. Отметка ставится один раз (первая дата — самая полезная: «не
 * слышит с 12-го»), ответ идёт дальше как был — вызывающий сам решает, что
 * делать с отказом. Сбой записи отметки письмо не роняет.
 */
export function installBlockedTracker(bot: Bot, db: Db): void {
  bot.api.config.use(async (prev, method, payload, signal) => {
    const res = await prev(method, payload, signal);
    if (!res.ok && res.error_code === 403) {
      const chatId = (payload as { chat_id?: unknown }).chat_id;
      if (typeof chatId === "number") {
        try {
          db.update(employees)
            .set({ botBlockedAt: new Date() })
            .where(and(eq(employees.telegramUserId, chatId), isNull(employees.botBlockedAt)))
            .run();
        } catch (err) {
          console.error("blocked tracker: mark failed:", safeErrorMessage(err));
        }
      }
    }
    return res;
  });
}

/** Человек написал или нажал кнопку — значит, бот ему снова доступен. */
export function clearBotBlocked(db: Db, telegramUserId: number): void {
  // Условие на отметку — чтобы каждый апдейт не был записью в базу.
  db.update(employees)
    .set({ botBlockedAt: null })
    .where(and(eq(employees.telegramUserId, telegramUserId), isNotNull(employees.botBlockedAt)))
    .run();
}
