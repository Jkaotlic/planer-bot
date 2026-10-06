import type { FoodSendReport, OrderRemindResult, OrderView, PollView } from "./api/food";
import { formatMoney } from "./collection";
import { FOOD_MENU_MAX, type PlaceInput } from "./food-order";

/**
 * Что экран говорит про заказ еды и опрос — одними словами в мини-аппе и в консоли.
 *
 * До 2026-10-06 всё это жило формулами внутри экранов мини-аппа (адреса — у
 * функций). Консоль повторяет те же экраны, и вторая копия разошлась бы с первой
 * на первой же правке текста: так уже разошлись строки меню — «1200 ₽» в списке
 * мест и «1 200 ₽» в форме заказа.
 */

/** Было: `FoodScreen.tsx:68`, `OrderScreen.tsx:102`. `closes` сам не гаснет — поэтому порядок проверок. */
export function orderStatusLabel(o: Pick<OrderView, "cancelled" | "open" | "closes">): string {
  return o.cancelled ? "отменён" : o.open ? (o.closes ?? "приём идёт") : "приём закрыт";
}

/** Было: `PollCard.tsx:37`. */
export function pollStatusLabel(p: Pick<PollView, "cancelled" | "open" | "closes">): string {
  return p.cancelled ? "отменён" : p.open ? (p.closes ?? "идёт") : "закрыт";
}

/**
 * Заказ ещё требует внимания — остаётся в «Идут» списка консоли.
 *
 * Не просто `open`: срок мог пройти до того, как тик закрыл приём, а у закрытого
 * заказа запускающий ещё неделю собирает деньги — «Кто сдал» и «Напомнить» нужны
 * ему именно тогда. Уехав в «Прошедшие», такой заказ пропал бы из виду ровно в
 * момент, когда по нему есть дело.
 */
export function orderInProgress(o: Pick<OrderView, "cancelled" | "open" | "closed" | "payment">): boolean {
  if (o.cancelled) return false;
  if (o.open || !o.closed) return true;
  return o.payment.paidCount < o.payment.total;
}

/** Кнопка блюда в открытом заказе. Было: `OrderScreen.tsx:165`. */
export function menuItemLabel(m: { name: string; price: number }): string {
  return `${m.name} · ${formatMoney(m.price)}`;
}

/**
 * Меню строкой — в форме заказа и в списке мест.
 *
 * Было две разные строки: `${m.price} ₽` в списке мест (`FoodScreen.tsx:170`, без
 * разбивки разрядов) и `${m.name} ${formatMoney(m.price)}` в форме (`OrderForm.tsx:104`).
 */
export function menuPreview(menu: readonly { name: string; price: number }[]): string {
  return menu.length > 0 ? menu.map((m) => `${m.name} — ${formatMoney(m.price)}`).join(" · ") : "Меню пусто";
}

/** Строка «Кто сколько». Было: `OrderScreen.tsx:203`. */
export function orderPersonLine(p: { displayName: string; amount: number; declined: boolean }): string {
  const what = p.declined ? "не будет" : p.amount > 0 ? formatMoney(p.amount) : "не ответил(а)";
  return `${p.displayName} — ${what}`;
}

/** Отчёт после рассылки, когда дошло не всем. Было: `PollForm.tsx:48`, `OrderForm.tsx:71`. */
export function sendReportText(r: FoodSendReport): string {
  return `Отправлено: ${r.delivered}. Не дошло: ${r.unreachable.join(", ")}`;
}

/** Итог «Напомнить не сдавшим». Было: `OrderScreen.tsx:72-74`. */
export function remindResultText(r: OrderRemindResult): string {
  if (r.unpaid === 0) return "Все уже сдали 🎉";
  return `Напомнил: ${r.delivered} из ${r.unpaid}` + (r.unreachable.length > 0 ? `. Не дошло: ${r.unreachable.join(", ")}` : "");
}

export interface MyOrderPayment {
  /** «Сдать: 600 ₽ — Аня» — сколько и кому; дательный от одного имени не построить. */
  oweLine: string | null;
  /** «Я сдал» доступно только после закрытия приёма — раньше сумма ещё меняется. */
  mark: "none" | "can-mark" | "marked";
}

/** Своя оплата участника. Было: условия трёх блоков `OrderScreen.tsx:137-156`. */
export function myOrderPayment(
  o: Pick<OrderView, "open" | "closed" | "cancelled" | "isCreator" | "myTotal" | "creatorName" | "payment">,
): MyOrderPayment {
  // Запускающий себе не должен — его позиции в долг не идут (`debtors`, решение 2026-09-29).
  const owes = !o.isCreator && o.myTotal > 0;
  const oweLine = owes && !o.open && !o.cancelled ? `Сдать: ${formatMoney(o.myTotal)} — ${o.creatorName}` : null;
  const mark = owes && o.closed ? (o.payment.myPaid ? "marked" : "can-mark") : "none";
  return { oweLine, mark };
}

/*
 * Вопросы подтверждения. Свой заказ — прежний вопрос мини-аппа; чужой называет
 * хозяина: админ видит в консоли заказы, куда его позвали, и может их закрыть, а
 * «сдай» уйдёт всем с именем того, кто собирает, — не с его.
 */
export function closeOrderQuestion(o: Pick<OrderView, "isCreator" | "creatorName">): string {
  return o.isCreator ? "Закрыть приём и разослать «сдай»?" : `Закрыть чужой заказ (собирает ${o.creatorName}) и разослать «сдай»?`;
}

export function cancelOrderQuestion(o: Pick<OrderView, "isCreator" | "creatorName">): string {
  return o.isCreator ? "Отменить заказ?" : `Отменить чужой заказ (собирает ${o.creatorName})?`;
}

export function closePollQuestion(p: Pick<PollView, "isCreator" | "creatorName">): string {
  return p.isCreator ? "Закрыть опрос?" : `Закрыть чужой опрос (спрашивает ${p.creatorName})?`;
}

export function cancelPollQuestion(p: Pick<PollView, "isCreator" | "creatorName">): string {
  return p.isCreator ? "Отменить опрос?" : `Отменить чужой опрос (спрашивает ${p.creatorName})?`;
}

/**
 * Цена из поля — только цифры. Строкой, а не числом: иначе «0» нельзя стереть до
 * пустого, чтобы набрать «350». Было: `.replace(/\D/g, "")` в двух экранах.
 */
export function priceDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

/** Было: `PlaceEditor.tsx:28`. */
export const EMPTY_DISH_NAME = "У блюда пустое название — впиши или удали строку ✕.";

/**
 * Почему пропала «+ Блюдо». Без строки кнопка исчезала молча на 30-й строке, и
 * человек не понимал, сломалось ли что-то. 30 — не вкус, а Telegram: больше кнопок
 * в письме не читаются (`FOOD_MENU_MAX`).
 */
export const FOOD_MENU_FULL_HINT = `В меню уже ${FOOD_MENU_MAX} блюд — больше не поместится в кнопки бота.`;

/** Строка редактора места: цена — строкой, пока человек её набирает. */
export interface PlaceEditorRow {
  id?: number;
  name: string;
  price: string;
}

/**
 * Меню для `saveFoodPlace` из строк редактора — или причина, почему сохранять нельзя.
 *
 * Пустая строка у СУЩЕСТВУЮЩЕГО блюда — ошибка, а не тихий пропуск: молча
 * выбросить её значило бы стереть блюдо из меню, хотя человек мог просто не
 * закончить правку имени. Новая пустая строка — нажатая и не заполненная
 * «+ Блюдо» — отбрасывается. Блюдо без цены раньше уходило на сервер нулём и
 * возвращалось общим «Проверь название, блюда и цены» — без слова о том, какое
 * блюдо виновато.
 */
export function placeMenuFromRows(
  rows: readonly PlaceEditorRow[],
): { ok: true; menu: PlaceInput["menu"] } | { ok: false; error: string } {
  if (rows.some((r) => r.id != null && !r.name.trim())) return { ok: false, error: EMPTY_DISH_NAME };
  const menu: PlaceInput["menu"] = [];
  for (const r of rows) {
    const name = r.name.trim();
    if (!name) continue;
    const price = Number(priceDigits(r.price));
    if (!price) return { ok: false, error: `У «${name}» не указана цена.` };
    menu.push({ ...(r.id != null ? { id: r.id } : {}), name, price });
  }
  return { ok: true, menu };
}
