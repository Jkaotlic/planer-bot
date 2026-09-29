import { InlineKeyboard, type Bot } from "grammy";
import { closesLabel, debtors, formatMoney, orderInviteText, organizerSummaryText, payRequestText } from "@planer/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { foodPlaces, type FoodOrder } from "../db/schema";
import { sendTracked } from "../bot/tracked-send";
import { notifyUser } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import type { TeamClock } from "../polls/poll-service";
import { menuForOrder } from "./place-service";
import { hasDeclined, itemsOf, orderRecipientRows, setOrderMessageId } from "./order-service";

/**
 * Кнопки заказа. Одна функция на рассылку и на правку после тапа — строки
 * колбэков `order:add:<id>:<блюдо>` не разъедутся. Цена — в подписи кнопки:
 * человек выбирает не только что, но и сколько отдаст.
 *
 * «Своё блюдо» — вход в мини-апп: два поля (что и сколько) в чате
 * превращаются в переписку с ботом, которую легко сбить.
 */
export function orderKeyboard(
  order: FoodOrder, menu: readonly { id: number; name: string; price: number }[], publicUrl: string, isCreator: boolean,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  menu.forEach((m, i) => {
    kb.text(`${m.name} · ${formatMoney(m.price)}`, `order:add:${order.id}:${m.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (menu.length % 2 === 1) kb.row();
  kb.webApp("✍️ Своё блюдо", `${publicUrl}/app/?screen=orders&order=${order.id}`).text("↩️ Убрать", `order:undo:${order.id}`).row();
  kb.text("🙅 Не буду", `order:no:${order.id}`);
  if (isCreator) kb.row().text("🔒 Закрыть приём", `order:close:${order.id}`);
  return kb;
}

function names(db: Db, order: FoodOrder) {
  const rows = orderRecipientRows(db, order.id);
  return { rows, byId: new Map(rows.map((r) => [r.employeeId, r.displayName])) };
}

/**
 * Имя места для письма и для аудита — без фильтра архивации: место могли
 * заархивировать посреди приёма, но заказ из него не перестаёт быть из него,
 * и запись в журнале не должна вдруг стать «без меню».
 */
export function placeName(db: Db, order: FoodOrder): string | null {
  return order.placeId == null ? null : db.select({ n: foodPlaces.name }).from(foodPlaces).where(eq(foodPlaces.id, order.placeId)).get()?.n ?? null;
}

export function orderTextFor(db: Db, order: FoodOrder, employeeId: number, today: string): string {
  const { byId } = names(db, order);
  return orderInviteText({
    creatorName: byId.get(order.createdBy) ?? "Коллега",
    placeName: placeName(db, order),
    note: order.note,
    payHint: order.payHint,
    closes: closesLabel(order.closesAt, today),
    myItems: itemsOf(db, order.id).filter((i) => i.employeeId === employeeId),
    declined: hasDeclined(db, order.id, employeeId),
  });
}

/**
 * Меню для письма и для кнопок — активные блюда места, даже если само место
 * успели архивировать. `getPlaceView` для архивного места отдаёт `null`, а
 * `menuForOrder` смотрит только на архивацию блюда — тем же правилом, что и
 * `activeMenuItem` (реальный обработчик тапа): письмо не должно показывать
 * меньше кнопок, чем сервер готов принять.
 */
export function orderMenu(db: Db, order: FoodOrder) {
  return order.placeId == null ? [] : menuForOrder(db, order.placeId);
}

export async function sendOrderInvites(bot: Bot, db: Db, order: FoodOrder, now: TeamClock, publicUrl: string): Promise<number> {
  const menu = orderMenu(db, order);
  let delivered = 0;
  for (const r of orderRecipientRows(db, order.id)) {
    if (r.telegramUserId == null) continue;
    const messageId = await sendTracked(bot, r.telegramUserId, orderTextFor(db, order, r.employeeId, now.date),
      orderKeyboard(order, menu, publicUrl, r.employeeId === order.createdBy));
    setOrderMessageId(db, order.id, r.employeeId, messageId);
    if (messageId != null) delivered += 1;
  }
  return delivered;
}

/**
 * Итог заказа. Запускающему — что заказать и кто сколько; каждому, кто должен,
 * — сколько и кому. Отказавшимся и самому запускающему «сдай» не уходит: долга
 * у них нет. Клавиатуры «Я сдал» / «Напомнить» подставляет Task 15 через
 * `payKeyboard` / `remindKeyboard` — до неё письма уходят без кнопок.
 */
export async function finishOrderMessages(
  bot: Bot, db: Db, order: FoodOrder, reason: "closed" | "cancelled", _publicUrl: string,
  keyboards: { pay?: (orderId: number) => InlineKeyboard; remind?: (orderId: number) => InlineKeyboard } = {},
): Promise<void> {
  const { rows, byId } = names(db, order);
  for (const r of rows) {
    if (r.telegramUserId == null || r.messageId == null) continue;
    try {
      await bot.api.editMessageReplyMarkup(r.telegramUserId, r.messageId, { reply_markup: new InlineKeyboard() });
    } catch (err) {
      console.error("order: cosmetic edit failed:", safeErrorMessage(err));
    }
  }
  const place = placeName(db, order);
  if (reason === "cancelled") {
    for (const r of rows) if (r.telegramUserId != null) await notifyUser(bot, r.telegramUserId, `🚫 Заказ${place ? ` из «${place}»` : ""} отменён.`);
    return;
  }
  const items = itemsOf(db, order.id);
  const creator = rows.find((r) => r.employeeId === order.createdBy);
  if (creator?.telegramUserId != null) {
    await notifyUser(bot, creator.telegramUserId, organizerSummaryText({ placeName: place, items, names: byId }), keyboards.remind?.(order.id));
  }
  for (const d of debtors(items, order.createdBy)) {
    const tg = rows.find((r) => r.employeeId === d.employeeId)?.telegramUserId;
    if (tg == null) continue;
    await notifyUser(bot, tg, payRequestText({ creatorName: byId.get(order.createdBy) ?? "Коллега", placeName: place, amount: d.amount, payHint: order.payHint }), keyboards.pay?.(order.id));
  }
}
