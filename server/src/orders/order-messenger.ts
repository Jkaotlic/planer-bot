import { InlineKeyboard, type Bot } from "grammy";
import {
  type FoodMenuItemShape, closesLetterLabel, debtors, formatMoney, isOpenAt, menuItemLabel, orderInviteText, organizerSummaryText, payRequestText, splitAtLines,
} from "@planer/shared";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { foodPlaces, type FoodOrder } from "../db/schema";
import { sendTracked } from "../bot/tracked-send";
import { notifyUser } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import type { TeamClock } from "../polls/poll-service";
import { menuForOrder } from "./place-service";
import { hasDeclined, itemsOf, orderRecipientRows, setOrderMessageId } from "./order-service";
import { unpaidDebtors } from "./order-payment-service";
import { queueFoodCloseMessages, type FoodCloseMessage, type FoodCloseReason } from "../food/food-close-delivery";

/**
 * Кнопки заказа. Одна функция на рассылку и на правку после тапа — строки
 * колбэков `order:add:<id>:<блюдо>` не разъедутся. Цена — в подписи кнопки:
 * человек выбирает не только что, но и сколько отдаст.
 *
 * «Своё блюдо» — вход в мини-апп: два поля (что и сколько) в чате
 * превращаются в переписку с ботом, которую легко сбить.
 */
export function orderKeyboard(
  order: FoodOrder, menu: readonly FoodMenuItemShape[], publicUrl: string, isCreator: boolean,
): InlineKeyboard {
  const kb = new InlineKeyboard();
  menu.forEach((m, i) => {
    kb.text(menuItemLabel(m), `order:add:${order.id}:${m.id}`);
    if (i % 2 === 1) kb.row();
  });
  if (menu.length % 2 === 1) kb.row();
  // В сборе закупки своих позиций нет: вход в мини-апп оттуда вёл бы в форму, которую сервер отклонит.
  if (order.allowCustom) kb.webApp("✍️ Своё блюдо", `${publicUrl}/app/?screen=orders&order=${order.id}`);
  kb.text("↩️ Убрать", `order:undo:${order.id}`).row();
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
    title: order.title,
    placeName: placeName(db, order),
    note: order.note,
    payHint: order.payHint,
    // Письмо читают позже, чем отправили, — срок не сегодня называется днём, не «завтра».
    closes: closesLetterLabel(order.closesAt, today),
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

/**
 * Перерисовать письмо заказа одного человека — после его правки в мини-аппе.
 *
 * Письмо печатает «Твой заказ», и без правки оно врало бы до следующего тапа
 * в чате. Косметика: ошибки (письмо удалено, «message is not modified») — в
 * лог, наружу ничего не бросается, и вызывающий её не ждёт. Закрытый заказ
 * не трогаем: снятие кнопок уже поставлено в очередь.
 */
export async function redrawOrderMessage(
  bot: Bot, db: Db, order: FoodOrder, employeeId: number, now: TeamClock, publicUrl: string,
): Promise<void> {
  try {
    if (!isOpenAt(order, now)) return;
    const row = orderRecipientRows(db, order.id).find((r) => r.employeeId === employeeId);
    if (row?.telegramUserId == null || row.messageId == null) return;
    await bot.api.editMessageText(row.telegramUserId, row.messageId, orderTextFor(db, order, employeeId, now.date), {
      reply_markup: orderKeyboard(order, orderMenu(db, order), publicUrl, order.createdBy === employeeId),
    });
  } catch (err) {
    console.error("order: cosmetic redraw failed:", safeErrorMessage(err));
  }
}

/** Одна строка колбэка на рассылку, дожим и правку после тапа — как `collectionPaidKeyboard`. */
export function payKeyboard(orderId: number): InlineKeyboard {
  return new InlineKeyboard().text("💸 Я сдал", `order:paid:${orderId}`);
}
export function payDoneKeyboard(orderId: number): InlineKeyboard {
  return new InlineKeyboard().text("✓ Ты отметился", `order:paid:${orderId}`);
}
export function remindKeyboard(orderId: number): InlineKeyboard {
  return new InlineKeyboard().text("⏰ Напомнить не сдавшим", `order:remind:${orderId}`);
}

/**
 * Дожим — только не сдавшим и только по кнопке: за 300 рублей бот сам людей
 * не долбит. `unpaid` — сколько ещё должны на момент вызова (знаменатель для
 * «D из N», не только «дошло»); `unreachable` — кого не достучаться, поимённо:
 * без Telegram или бот заблокирован. Нулевой `delivered` при `unreachable`
 * непустом — не то же самое, что «все уже сдали», и вызывающий должен уметь
 * их различить, а не рапортовать «дожал», когда никто письма не увидел.
 */
export async function remindUnpaid(bot: Bot, db: Db, order: FoodOrder): Promise<{ delivered: number; unpaid: number; unreachable: string[] }> {
  const creator = orderRecipientRows(db, order.id).find((r) => r.employeeId === order.createdBy)?.displayName ?? "Коллега";
  const debtors_ = unpaidDebtors(db, order);
  // «за заказ еды» узнаётся только у обычного заказа; у сбора с названием — по названию.
  const heading = order.title;
  let delivered = 0;
  const unreachable: string[] = [];
  for (const d of debtors_) {
    if (d.telegramUserId == null) { unreachable.push(d.displayName); continue; }
    const text = `⏰ Напоминаю: за ${heading ? `«${heading}»` : "заказ еды"} сдай ${formatMoney(d.amount)} — ${creator}.${order.payHint ? `\nКуда: ${order.payHint}` : ""}`;
    if (await notifyUser(bot, d.telegramUserId, text, payKeyboard(order.id))) delivered += 1;
    else unreachable.push(d.displayName);
  }
  return { delivered, unpaid: debtors_.length, unreachable };
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
 * Итог заказа. Запускающему — что заказать и кто сколько плюс «Напомнить не
 * сдавшим»; каждому, кто должен, — сколько, кому и «Я сдал». Отказавшимся и
 * самому запускающему «сдай» не уходит: долга у них нет.
 */
export function queueOrderCloseMessages(db: Db, order: FoodOrder, reason: FoodCloseReason): void {
  const { rows: all, byId } = names(db, order);
  // Имена — всех (сводка называет и архивного должника), письма — только тем,
  // кто ещё в команде.
  const rows = all.filter((r) => r.isActive);
  const messages: FoodCloseMessage[] = [];
  for (const r of rows) {
    if (r.telegramUserId == null || r.messageId == null) continue;
    messages.push({ employeeId: r.employeeId, telegramUserId: r.telegramUserId, messageId: r.messageId });
  }
  const place = placeName(db, order);
  if (reason === "cancelled") {
    const what = order.title ? `Сбор «${order.title}»` : `Заказ${place ? ` из «${place}»` : ""}`;
    for (const r of rows) {
      if (r.telegramUserId == null) continue;
      messages.push({ employeeId: r.employeeId, telegramUserId: r.telegramUserId, body: `🚫 ${what} отменён.` });
    }
    queueFoodCloseMessages(db, `order:${order.id}`, messages);
    return;
  }
  const items = itemsOf(db, order.id);
  const creator = rows.find((r) => r.employeeId === order.createdBy);
  if (creator?.telegramUserId != null) {
    // Сводка большой команды может не влезть в одно письмо (лимит Telegram —
    // 4096 знаков): режем по строкам, «Напомнить» — под последним куском,
    // после «Итого».
    const parts = splitAtLines(organizerSummaryText({ title: order.title, placeName: place, items, names: byId }));
    for (const [i, part] of parts.entries()) {
      messages.push({
        employeeId: creator.employeeId,
        telegramUserId: creator.telegramUserId,
        body: part,
        keyboard: i === parts.length - 1 ? remindKeyboard(order.id) : undefined,
      });
    }
  }
  for (const d of debtors(items, order.createdBy)) {
    const tg = rows.find((r) => r.employeeId === d.employeeId)?.telegramUserId;
    if (tg == null) continue;
    messages.push({
      employeeId: d.employeeId,
      telegramUserId: tg,
      body: payRequestText({ creatorName: byId.get(order.createdBy) ?? "Коллега", title: order.title, placeName: place, amount: d.amount, payHint: order.payHint }),
      keyboard: payKeyboard(order.id),
      paymentOrderId: order.id,
    });
  }
  queueFoodCloseMessages(db, `order:${order.id}`, messages);
}
