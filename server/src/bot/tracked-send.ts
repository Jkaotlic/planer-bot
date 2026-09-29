import type { Bot, InlineKeyboard } from "grammy";
import { safeErrorMessage } from "../util/safe-error";

/**
 * `notifyUser`, который помнит, какое письмо ушло.
 *
 * Опросу и заказу нужно потом погасить кнопки в каждом разосланном письме —
 * иначе человек через час жмёт «Шаурма» в закрытом заказе и получает отказ,
 * которого по виду письма не ожидал. `notifyUser` отвечает только «дошло или
 * нет», и менять его ради двух новых вызывающих — трогать полтора десятка
 * старых.
 */
export async function sendTracked(
  bot: Bot,
  telegramUserId: number,
  text: string,
  keyboard?: InlineKeyboard,
): Promise<number | null> {
  try {
    const sent = await bot.api.sendMessage(telegramUserId, text, keyboard ? { reply_markup: keyboard } : undefined);
    return typeof sent?.message_id === "number" ? sent.message_id : null;
  } catch (err) {
    console.error(`sendTracked: failed for ${telegramUserId}:`, safeErrorMessage(err));
    return null;
  }
}
