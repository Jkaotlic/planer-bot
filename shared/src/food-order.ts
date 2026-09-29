import { z } from "zod";
import { formatMoney } from "./collection";

/**
 * Лимиты заказа еды. Один процесс держит и API, и long-polling бота, поэтому
 * всё, что уходит в рассылку или в кнопки чата, ограничено сверху.
 *
 * 30 блюд — не вкус, а Telegram: больше кнопок в письме не читаются, а
 * `callback_data` каждой — ещё строка в каждом письме каждому адресату.
 */
export const FOOD_TEXT_MAX = 200;
export const FOOD_NOTE_MAX = 300;
export const FOOD_MENU_MAX = 30;
export const FOOD_PRICE_MAX = 100_000;
export const FOOD_QTY_MAX = 20;
/**
 * Строк своих позиций на человека в одном заказе. Не вкус, а сводка
 * запускающему: 20 строк × 200 знаков названия на каждого — и так уже
 * несколько писем (`splitAtLines`); без потолка одна кнопка «Добавить» в
 * цикле раздула бы её до сотни.
 */
export const FOOD_ITEMS_PER_PERSON_MAX = 20;
/** Потолок одного письма с запасом до лимита Telegram в 4096 знаков. */
export const TELEGRAM_TEXT_SAFE_MAX = 4000;

/** Цена — целые рубли: копейки в обеде никто не сдаёт, а дробь в долге — повод для спора. */
export const foodPriceSchema = z.number().int().min(1).max(FOOD_PRICE_MAX);
const foodText = z.string().trim().min(1).max(FOOD_TEXT_MAX);

export const placeInputSchema = z
  .object({
    name: foodText,
    menu: z
      .array(z.object({ id: z.number().int().positive().optional(), name: foodText, price: foodPriceSchema }).strict())
      .max(FOOD_MENU_MAX),
  })
  .strict()
  .refine(
    (p) => new Set(p.menu.map((m) => m.name.toLocaleLowerCase("ru"))).size === p.menu.length,
    { message: "В меню два блюда с одним названием — в чате их кнопки не различить.", path: ["menu"] },
  )
  // Повторный id в одном теле запроса — само по себе противоречивое тело:
  // сервис (`updatePlace`) обновляет блюдо по id первым найденным, и вторая
  // строка с тем же id молча потерялась бы, а не стала отдельным блюдом.
  .refine(
    (p) => {
      const ids = p.menu.map((m) => m.id).filter((id): id is number => id != null);
      return new Set(ids).size === ids.length;
    },
    { message: "В меню дважды указан один и тот же id блюда.", path: ["menu"] },
  );

export type PlaceInput = z.infer<typeof placeInputSchema>;

export interface OrderItemLike {
  employeeId: number;
  name: string;
  price: number;
  qty: number;
}

export function debtOf(items: readonly OrderItemLike[], employeeId: number): number {
  return items.filter((i) => i.employeeId === employeeId).reduce((sum, i) => sum + i.price * i.qty, 0);
}

export function orderTotal(items: readonly OrderItemLike[]): number {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}

/**
 * Что заказывать — одинаковое сложено. Разная цена у одного блюда — разные
 * строки: так бывает, когда меню поправили посреди приёма, и тот, кто
 * заказывает, должен это увидеть, а не получить среднюю цену.
 */
export function dishSummary(items: readonly OrderItemLike[]): { name: string; price: number; qty: number }[] {
  const byKey = new Map<string, { name: string; price: number; qty: number }>();
  for (const i of items) {
    const key = `${i.name}\u0000${i.price}`;
    const row = byKey.get(key) ?? { name: i.name, price: i.price, qty: 0 };
    row.qty += i.qty;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "ru") || a.price - b.price);
}

/**
 * Кто сколько должен запускающему. Сам запускающий не должен себе — его
 * позиции в долг не идут (решение спеки 2026-09-29).
 */
export function debtors(items: readonly OrderItemLike[], creatorId: number): { employeeId: number; amount: number }[] {
  const order: number[] = [];
  for (const i of items) if (i.employeeId !== creatorId && !order.includes(i.employeeId)) order.push(i.employeeId);
  return order.map((employeeId) => ({ employeeId, amount: debtOf(items, employeeId) })).filter((d) => d.amount > 0);
}

export function itemLines(items: readonly Pick<OrderItemLike, "name" | "price" | "qty">[]): string[] {
  return items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""} — ${formatMoney(i.price * i.qty)}`);
}

/**
 * Письмо заказа — и оно же после каждого тапа. Свой заказ печатается в тексте:
 * кнопки меню одинаковы для всех, и без этой строки человек не видит, что
 * уже набрал.
 */
export function orderInviteText(input: {
  creatorName: string;
  placeName: string | null;
  note: string | null;
  payHint: string | null;
  closes: string | null;
  myItems: readonly Pick<OrderItemLike, "name" | "price" | "qty">[];
  declined: boolean;
}): string {
  const lines = [`🍱 ${input.creatorName} собирает заказ${input.placeName ? `: ${input.placeName}` : ""}`];
  if (input.closes) lines.push(`Приём ${input.closes}`);
  if (input.note) lines.push("", input.note);
  if (input.payHint) lines.push("", `Куда сдавать: ${input.payHint}`);
  if (input.myItems.length > 0) {
    const total = input.myItems.reduce((s, i) => s + i.price * i.qty, 0);
    lines.push("", "Твой заказ:", ...itemLines(input.myItems), `Итого: ${formatMoney(total)}`);
  } else if (input.declined) {
    lines.push("", "Ты не заказываешь.");
  }
  return lines.join("\n");
}

/** Сводка тому, кто оформляет заказ: сначала что заказать, потом кто сколько. */
export function organizerSummaryText(input: {
  placeName: string | null;
  items: readonly OrderItemLike[];
  names: ReadonlyMap<number, string>;
}): string {
  const lines = [`📋 Заказ${input.placeName ? ` из «${input.placeName}»` : ""} закрыт.`, "", "Что заказать:"];
  for (const d of dishSummary(input.items)) {
    lines.push(`${d.name}${d.qty > 1 ? ` ×${d.qty}` : ""} — ${formatMoney(d.price * d.qty)}`);
  }
  lines.push("", "Кто сколько:");
  const people: number[] = [];
  for (const i of input.items) if (!people.includes(i.employeeId)) people.push(i.employeeId);
  for (const id of people) lines.push(`${input.names.get(id) ?? "—"} — ${formatMoney(debtOf(input.items, id))}`);
  lines.push("", `Итого: ${formatMoney(orderTotal(input.items))}`);
  return lines.join("\n");
}

/**
 * Режет длинный текст на письма не длиннее `max` — по границам строк, чтобы
 * строка «Имя — 350 ₽» не разорвалась между письмами. Telegram отказывает
 * письму длиннее 4096 знаков целиком, и сводка большой команды не дошла бы
 * вовсе. Строка длиннее `max` режется жёстко: при наших лимитах (название до
 * 200 знаков) её не бывает, но и отказ всего письма из-за неё хуже.
 */
export function splitAtLines(text: string, max = TELEGRAM_TEXT_SAFE_MAX): string[] {
  if (text.length <= max) return [text];
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= max) { lines.push(line); continue; }
    for (let i = 0; i < line.length; i += max) lines.push(line.slice(i, i + max));
  }
  const parts: string[] = [];
  let current: string | null = null;
  for (const line of lines) {
    if (current === null) current = line;
    else if (current.length + 1 + line.length <= max) current += `\n${line}`;
    else { parts.push(current); current = line; }
  }
  if (current !== null) parts.push(current);
  // Пустая строка-разделитель на стыке дала бы письмо, начинающееся с
  // пустоты, или вовсе пустое — Telegram такое не отправит.
  return parts.map((p) => p.replace(/^\n+|\n+$/g, "")).filter((p) => p.length > 0);
}

export function payRequestText(input: { creatorName: string; placeName: string | null; amount: number; payHint: string | null }): string {
  const head = `💸 Заказ${input.placeName ? ` из «${input.placeName}»` : ""} закрыт. Сдай ${formatMoney(input.amount)} — ${input.creatorName}.`;
  return input.payHint ? `${head}\nКуда: ${input.payHint}` : head;
}

const qty = z.number().int().min(1).max(FOOD_QTY_MAX).default(1);

export const orderItemInputSchema = z.union([
  z.object({ menuItemId: z.number().int().positive(), qty }).strict(),
  z.object({ name: foodText, price: foodPriceSchema, qty }).strict(),
]);
export type OrderItemInput = z.infer<typeof orderItemInputSchema>;
