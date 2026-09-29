import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { FOOD_ITEMS_PER_PERSON_MAX, FOOD_QTY_MAX, closesLabel, debtOf, debtors, dishSummary, isOpenAt, orderTotal, type PaymentRow } from "@planer/shared";
import type { Db } from "../db/client";
import {
  employees, foodOrderDeclines, foodOrderItems, foodOrderRecipients, foodOrders, foodPlaces,
  type FoodOrder, type FoodOrderItem,
} from "../db/schema";
import { FOOD_REPEAT_WINDOW_SEC, canManage, type Result, type TeamClock } from "../polls/poll-service";
import { orderPayments } from "./order-payment-service";
import { activeMenuItem, menuForOrder } from "./place-service";

type Viewer = { id: number; isAdmin: boolean };

export function createOrder(db: Db, input: {
  createdBy: number; placeId: number | null; note: string | null; payHint: string | null; closesAt: string | null; recipientIds: number[];
}): FoodOrder {
  return db.transaction((tx) => {
    const { recipientIds, ...values } = input;
    const order = tx.insert(foodOrders).values(values).returning().get();
    for (const employeeId of recipientIds) {
      tx.insert(foodOrderRecipients).values({ orderId: order.id, employeeId }).onConflictDoNothing().run();
    }
    return order;
  });
}

/**
 * Был ли заказ из того же места (или тоже без места) от того же человека за
 * последние `FOOD_REPEAT_WINDOW_SEC` — повтор, а не новый заказ. Правила те
 * же, что у `hasRecentSamePoll`: часы базы, отменённый не считается.
 */
export function hasRecentSameOrder(db: Db, createdBy: number, placeId: number | null): boolean {
  return db.select({ id: foodOrders.id }).from(foodOrders).where(and(
    eq(foodOrders.createdBy, createdBy), isNull(foodOrders.cancelledAt),
    placeId == null ? isNull(foodOrders.placeId) : eq(foodOrders.placeId, placeId),
    gte(foodOrders.createdAt, sql`unixepoch() - ${FOOD_REPEAT_WINDOW_SEC}`),
  )).get() != null;
}

export function getOrder(db: Db, id: number): FoodOrder | undefined {
  return db.select().from(foodOrders).where(eq(foodOrders.id, id)).get();
}

export function orderRecipientRows(db: Db, orderId: number) {
  return db.select({
    employeeId: foodOrderRecipients.employeeId,
    displayName: employees.displayName,
    telegramUserId: employees.telegramUserId,
    messageId: foodOrderRecipients.messageId,
  }).from(foodOrderRecipients)
    .innerJoin(employees, eq(employees.id, foodOrderRecipients.employeeId))
    .where(eq(foodOrderRecipients.orderId, orderId))
    .orderBy(foodOrderRecipients.employeeId).all();
}

export function setOrderMessageId(db: Db, orderId: number, employeeId: number, messageId: number | null): void {
  db.update(foodOrderRecipients).set({ messageId })
    .where(and(eq(foodOrderRecipients.orderId, orderId), eq(foodOrderRecipients.employeeId, employeeId))).run();
}

export function itemsOf(db: Db, orderId: number): FoodOrderItem[] {
  return db.select().from(foodOrderItems).where(eq(foodOrderItems.orderId, orderId)).orderBy(foodOrderItems.id).all();
}

export function hasDeclined(db: Db, orderId: number, employeeId: number): boolean {
  return db.select().from(foodOrderDeclines)
    .where(and(eq(foodOrderDeclines.orderId, orderId), eq(foodOrderDeclines.employeeId, employeeId))).get() != null;
}

function isRecipient(db: Db, orderId: number, employeeId: number): boolean {
  return orderRecipientRows(db, orderId).some((r) => r.employeeId === employeeId);
}

/**
 * Общий вход любой правки позиций: сначала «закрыт», потом «тебе ли» — тот же
 * порядок, что у опросов, в боте и в HTTP.
 */
function guard(db: Db, order: FoodOrder, employeeId: number, now: TeamClock): Result {
  if (!isOpenAt(order, now)) return { ok: false, error: "Приём закрыт." };
  if (!isRecipient(db, order.id, employeeId)) return { ok: false, error: "Этот заказ тебе не приходил." };
  return { ok: true };
}

/** Любая своя позиция снимает отказ: человек передумал, и «Не буду» в сводке
 *  было бы враньём. */
function clearDecline(db: Db, orderId: number, employeeId: number): void {
  db.delete(foodOrderDeclines)
    .where(and(eq(foodOrderDeclines.orderId, orderId), eq(foodOrderDeclines.employeeId, employeeId))).run();
}

const TOO_MANY_ITEMS = `Больше ${FOOD_ITEMS_PER_PERSON_MAX} позиций — это уже не обед.`;

/** Сколько строк у человека уже есть — потолок `FOOD_ITEMS_PER_PERSON_MAX` считает строки, а не штуки. */
function ownRowCount(db: Db, orderId: number, employeeId: number): number {
  return db.select({ id: foodOrderItems.id }).from(foodOrderItems)
    .where(and(eq(foodOrderItems.orderId, orderId), eq(foodOrderItems.employeeId, employeeId))).all().length;
}

export function addMenuItem(db: Db, order: FoodOrder, employeeId: number, menuItemId: number, now: TeamClock): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  const dish = order.placeId == null ? undefined : activeMenuItem(db, order.placeId, menuItemId);
  if (!dish) return { ok: false, error: "Этого блюда нет в меню." };
  // Прибавляем к строке с той же ценой: если цену поправили посреди приёма,
  // новый тап — новая строка, и старый долг не переписывается задним числом.
  const same = db.select().from(foodOrderItems).where(and(
    eq(foodOrderItems.orderId, order.id), eq(foodOrderItems.employeeId, employeeId),
    eq(foodOrderItems.menuItemId, menuItemId), eq(foodOrderItems.price, dish.price),
  )).get();
  if (same) {
    if (same.qty >= FOOD_QTY_MAX) return { ok: false, error: `Больше ${FOOD_QTY_MAX} одного блюда — это уже не обед.` };
    db.update(foodOrderItems).set({ qty: same.qty + 1 }).where(eq(foodOrderItems.id, same.id)).run();
  } else {
    if (ownRowCount(db, order.id, employeeId) >= FOOD_ITEMS_PER_PERSON_MAX) return { ok: false, error: TOO_MANY_ITEMS };
    db.insert(foodOrderItems).values({ orderId: order.id, employeeId, menuItemId, name: dish.name, price: dish.price, qty: 1 }).run();
  }
  clearDecline(db, order.id, employeeId);
  return { ok: true };
}

export function addCustomItem(
  db: Db, order: FoodOrder, employeeId: number, input: { name: string; price: number; qty: number }, now: TeamClock,
): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  if (ownRowCount(db, order.id, employeeId) >= FOOD_ITEMS_PER_PERSON_MAX) return { ok: false, error: TOO_MANY_ITEMS };
  db.insert(foodOrderItems).values({ orderId: order.id, employeeId, menuItemId: null, ...input }).run();
  clearDecline(db, order.id, employeeId);
  return { ok: true };
}

function ownItem(db: Db, order: FoodOrder, employeeId: number, itemId: number): FoodOrderItem | Result {
  const item = db.select().from(foodOrderItems).where(and(eq(foodOrderItems.id, itemId), eq(foodOrderItems.orderId, order.id))).get();
  if (!item || item.employeeId !== employeeId) return { ok: false, error: "Это не твоя позиция." };
  return item;
}

export function setItemQty(db: Db, order: FoodOrder, employeeId: number, itemId: number, qty: number, now: TeamClock): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  const item = ownItem(db, order, employeeId, itemId);
  if ("ok" in item) return item;
  db.update(foodOrderItems).set({ qty }).where(eq(foodOrderItems.id, item.id)).run();
  return { ok: true };
}

export function removeItem(db: Db, order: FoodOrder, employeeId: number, itemId: number, now: TeamClock): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  const item = ownItem(db, order, employeeId, itemId);
  if ("ok" in item) return item;
  db.delete(foodOrderItems).where(eq(foodOrderItems.id, item.id)).run();
  return { ok: true };
}

export function removeLastItem(db: Db, order: FoodOrder, employeeId: number, now: TeamClock): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  const last = db.select().from(foodOrderItems)
    .where(and(eq(foodOrderItems.orderId, order.id), eq(foodOrderItems.employeeId, employeeId)))
    .orderBy(desc(foodOrderItems.id)).get();
  if (!last) return { ok: false, error: "Убирать нечего." };
  if (last.qty > 1) db.update(foodOrderItems).set({ qty: last.qty - 1 }).where(eq(foodOrderItems.id, last.id)).run();
  else db.delete(foodOrderItems).where(eq(foodOrderItems.id, last.id)).run();
  return { ok: true };
}

export function declineOrder(db: Db, order: FoodOrder, employeeId: number, now: TeamClock): Result {
  const allowed = guard(db, order, employeeId, now);
  if (!allowed.ok) return allowed;
  db.transaction((tx) => {
    tx.delete(foodOrderItems).where(and(eq(foodOrderItems.orderId, order.id), eq(foodOrderItems.employeeId, employeeId))).run();
    tx.insert(foodOrderDeclines).values({ orderId: order.id, employeeId }).onConflictDoNothing().run();
  });
  return { ok: true };
}

/** Условный UPDATE — по той же причине, что `finish` у опросов: закрытие одно. */
function finish(db: Db, orderId: number, column: "closedAt" | "cancelledAt"): boolean {
  return db.update(foodOrders).set({ [column]: new Date() })
    .where(and(eq(foodOrders.id, orderId), isNull(foodOrders.closedAt), isNull(foodOrders.cancelledAt)))
    .run().changes > 0;
}

export function closeOrder(db: Db, order: FoodOrder, viewer: Viewer): Result {
  if (!canManage(order, viewer)) return { ok: false, error: "Закрыть может только тот, кто собирает заказ." };
  if (order.cancelledAt != null) return { ok: false, error: "Заказ отменён." };
  return finish(db, order.id, "closedAt") ? { ok: true } : { ok: false, error: "Приём уже закрыт." };
}

export function cancelOrder(db: Db, order: FoodOrder, viewer: Viewer): Result {
  if (!canManage(order, viewer)) return { ok: false, error: "Отменить может только тот, кто собирает заказ." };
  return finish(db, order.id, "cancelledAt") ? { ok: true } : { ok: false, error: "Приём уже закрыт." };
}

export function closeDueOrders(db: Db, now: TeamClock): FoodOrder[] {
  const due = db.select().from(foodOrders).where(and(
    isNull(foodOrders.closedAt), isNull(foodOrders.cancelledAt), isNotNull(foodOrders.closesAt),
    lte(foodOrders.closesAt, `${now.date}T${now.time}`),
  )).all();
  return due.filter((o) => finish(db, o.id, "closedAt"));
}

export interface OrderView {
  id: number;
  creatorId: number;
  creatorName: string;
  placeId: number | null;
  placeName: string | null;
  menu: { id: number; name: string; price: number }[];
  note: string | null;
  payHint: string | null;
  closesAt: string | null;
  closes: string | null;
  open: boolean;
  closed: boolean;
  cancelled: boolean;
  isCreator: boolean;
  canManage: boolean;
  myItems: { id: number; name: string; price: number; qty: number }[];
  myTotal: number;
  declined: boolean;
  recipientCount: number;
  respondedCount: number;
  dishes: { name: string; price: number; qty: number }[];
  total: number;
  people: { employeeId: number; displayName: string; amount: number; declined: boolean }[] | null;
  payment: {
    myPaid: boolean;
    paidCount: number;
    total: number;
    rows: (PaymentRow & { amount: number })[] | null;
  };
}

/**
 * Заказ глазами смотрящего. Список «кто сколько» — только тому, кто управляет:
 * сумма коллеги — не общее знание (та же позиция, что в сборах, спека
 * 2026-08-27). Сводку по блюдам видят все — она про еду, а не про людей.
 */
export function orderView(db: Db, order: FoodOrder, viewer: Viewer, now: TeamClock): OrderView | null {
  const recipients = orderRecipientRows(db, order.id);
  const manage = canManage(order, viewer);
  if (!manage && !recipients.some((r) => r.employeeId === viewer.id)) return null;
  const items = itemsOf(db, order.id);
  const declines = new Set(db.select({ id: foodOrderDeclines.employeeId }).from(foodOrderDeclines)
    .where(eq(foodOrderDeclines.orderId, order.id)).all().map((d) => d.id));
  const place = order.placeId == null ? null : db.select().from(foodPlaces).where(eq(foodPlaces.id, order.placeId)).get() ?? null;
  const responded = new Set([...items.map((i) => i.employeeId), ...declines]);
  const open = isOpenAt(order, now);
  const mine = items.filter((i) => i.employeeId === viewer.id);
  return {
    id: order.id,
    creatorId: order.createdBy,
    creatorName: recipients.find((r) => r.employeeId === order.createdBy)?.displayName
      ?? db.select({ n: employees.displayName }).from(employees).where(eq(employees.id, order.createdBy)).get()?.n ?? "—",
    placeId: order.placeId,
    placeName: place?.name ?? null,
    menu: open && order.placeId != null ? menuForOrder(db, order.placeId) : [],
    note: order.note,
    payHint: order.payHint,
    closesAt: order.closesAt,
    closes: closesLabel(order.closesAt, now.date),
    open,
    closed: order.closedAt != null,
    cancelled: order.cancelledAt != null,
    isCreator: order.createdBy === viewer.id,
    canManage: manage,
    myItems: mine.map(({ id, name, price, qty }) => ({ id, name, price, qty })),
    myTotal: debtOf(items, viewer.id),
    declined: declines.has(viewer.id),
    recipientCount: recipients.length,
    respondedCount: responded.size,
    dishes: dishSummary(items),
    total: orderTotal(items),
    people: manage
      ? recipients.map((r) => ({ employeeId: r.employeeId, displayName: r.displayName, amount: debtOf(items, r.employeeId), declined: declines.has(r.employeeId) }))
      : null,
    payment: (() => {
      const progress = orderPayments(db, order);
      const amounts = new Map(debtors(items, order.createdBy).map((d) => [d.employeeId, d.amount]));
      return {
        myPaid: progress.rows.some((r) => r.employeeId === viewer.id && r.paid),
        paidCount: progress.paidCount,
        total: progress.total,
        rows: manage ? progress.rows.map((r) => ({ ...r, amount: amounts.get(r.employeeId) ?? 0 })) : null,
      };
    })(),
  };
}

export function listOrdersFor(db: Db, viewer: Viewer, now: TeamClock): OrderView[] {
  const mine = db.select({ id: foodOrderRecipients.orderId }).from(foodOrderRecipients)
    .where(eq(foodOrderRecipients.employeeId, viewer.id)).all().map((r) => r.id);
  return db.select().from(foodOrders)
    .where(or(eq(foodOrders.createdBy, viewer.id), mine.length > 0 ? inArray(foodOrders.id, mine) : undefined))
    .orderBy(desc(foodOrders.id)).limit(20).all()
    .map((o) => orderView(db, o, viewer, now)).filter((v): v is OrderView => v != null);
}
