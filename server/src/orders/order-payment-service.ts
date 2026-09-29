import { and, eq } from "drizzle-orm";
import { debtors, paymentProgress, type PaymentProgress } from "@planer/shared";
import type { Db } from "../db/client";
import { foodOrderPayments, type FoodOrder } from "../db/schema";
import { canManage } from "../polls/poll-service";
import { itemsOf, orderRecipientRows } from "./order-service";

type Viewer = { id: number; isAdmin: boolean };

/** Итог отметки: `changed` — правда ли что-то поменялось в базе. Повторный
 *  тап по уже стоящей галочке или по уже снятой — не повод писать в аудит
 *  или считать это событием, но и не повод отвечать отказом (идемпотентность). */
export type SetPaidResult = { ok: true; changed: boolean } | { ok: false; error: string };

function debtorRows(db: Db, order: FoodOrder) {
  const recipients = orderRecipientRows(db, order.id);
  return debtors(itemsOf(db, order.id), order.createdBy).map((d) => {
    const r = recipients.find((x) => x.employeeId === d.employeeId);
    return { employeeId: d.employeeId, displayName: r?.displayName ?? "—", telegramUserId: r?.telegramUserId ?? null, amount: d.amount };
  });
}

function marksOf(db: Db, orderId: number) {
  return db.select({ employeeId: foodOrderPayments.employeeId, markedBy: foodOrderPayments.markedBy })
    .from(foodOrderPayments).where(eq(foodOrderPayments.orderId, orderId)).all();
}

/**
 * «Сдали N из M». Знаменатель — должники, а не адресаты: отказавшийся и
 * запускающий не должны ничего, и счёт «2 из 5» при двух должниках врал бы.
 * Форма — та же `paymentProgress`, что у сборов.
 */
export function orderPayments(db: Db, order: FoodOrder): PaymentProgress {
  return paymentProgress(debtorRows(db, order), marksOf(db, order.id));
}

/** Должники, кто ещё не отметился, — для дожима. `displayName` остаётся в
 *  строке: «Напомнить» должен показать поимённо, до кого не достучался. */
export function unpaidDebtors(db: Db, order: FoodOrder) {
  const paid = new Set(marksOf(db, order.id).map((m) => m.employeeId));
  return debtorRows(db, order).filter((d) => !paid.has(d.employeeId));
}

/**
 * Отметка «сдал». Бот утверждает то, чего не проверял, — как и в сборах:
 * это слово человека (или запускающего, получившего наличку), а не выписка.
 *
 * `changed` отдельно от `ok`: повторный тап по уже стоящей галочке — не
 * отказ (идемпотентность), но и не факт, достойный строки в аудите или
 * счётчика «отметил ещё одного» — вызывающий решает по нему, писать ли.
 */
export function setOrderPaid(db: Db, order: FoodOrder, employeeId: number, viewer: Viewer, paid: boolean): SetPaidResult {
  if (order.cancelledAt != null) return { ok: false, error: "Заказ отменён — сдавать нечего." };
  if (order.closedAt == null) return { ok: false, error: "Сдавать рано: приём ещё идёт." };
  if (!debtorRows(db, order).some((d) => d.employeeId === employeeId)) return { ok: false, error: "Этот человек ничего не должен." };
  const manage = canManage(order, viewer);
  const existing = db.select().from(foodOrderPayments)
    .where(and(eq(foodOrderPayments.orderId, order.id), eq(foodOrderPayments.employeeId, employeeId))).get();
  if (paid) {
    if (employeeId !== viewer.id && !manage) return { ok: false, error: "Отметить за другого может только тот, кто собирает заказ." };
    const result = db.insert(foodOrderPayments).values({ orderId: order.id, employeeId, markedBy: viewer.id }).onConflictDoNothing().run();
    return { ok: true, changed: result.changes > 0 };
  }
  if (!existing) return { ok: true, changed: false };
  if (existing.markedBy !== viewer.id && !manage) return { ok: false, error: "Снять отметку может тот, кто её поставил." };
  db.delete(foodOrderPayments).where(eq(foodOrderPayments.id, existing.id)).run();
  return { ok: true, changed: true };
}
