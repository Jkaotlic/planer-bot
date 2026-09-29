import { and, eq } from "drizzle-orm";
import { debtors, paymentProgress, type PaymentProgress } from "@planer/shared";
import type { Db } from "../db/client";
import { foodOrderPayments, type FoodOrder } from "../db/schema";
import { canManage, type Result } from "../polls/poll-service";
import { itemsOf, orderRecipientRows } from "./order-service";

type Viewer = { id: number; isAdmin: boolean };

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

export function unpaidDebtors(db: Db, order: FoodOrder) {
  const paid = new Set(marksOf(db, order.id).map((m) => m.employeeId));
  return debtorRows(db, order).filter((d) => !paid.has(d.employeeId))
    .map(({ employeeId, telegramUserId, amount }) => ({ employeeId, telegramUserId, amount }));
}

/**
 * Отметка «сдал». Бот утверждает то, чего не проверял, — как и в сборах:
 * это слово человека (или запускающего, получившего наличку), а не выписка.
 */
export function setOrderPaid(db: Db, order: FoodOrder, employeeId: number, viewer: Viewer, paid: boolean): Result {
  if (order.cancelledAt != null) return { ok: false, error: "Заказ отменён — сдавать нечего." };
  if (order.closedAt == null) return { ok: false, error: "Сдавать рано: приём ещё идёт." };
  if (!debtorRows(db, order).some((d) => d.employeeId === employeeId)) return { ok: false, error: "Этот человек ничего не должен." };
  const manage = canManage(order, viewer);
  const existing = db.select().from(foodOrderPayments)
    .where(and(eq(foodOrderPayments.orderId, order.id), eq(foodOrderPayments.employeeId, employeeId))).get();
  if (paid) {
    if (employeeId !== viewer.id && !manage) return { ok: false, error: "Отметить за другого может только тот, кто собирает заказ." };
    db.insert(foodOrderPayments).values({ orderId: order.id, employeeId, markedBy: viewer.id }).onConflictDoNothing().run();
    return { ok: true };
  }
  if (!existing) return { ok: true };
  if (existing.markedBy !== viewer.id && !manage) return { ok: false, error: "Снять отметку может тот, кто её поставил." };
  db.delete(foodOrderPayments).where(eq(foodOrderPayments.id, existing.id)).run();
  return { ok: true };
}
