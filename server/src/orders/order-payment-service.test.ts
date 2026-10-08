import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { addCustomItem, closeOrder, createOrder, getOrder } from "./order-service";
import { orderPayments, setOrderPaid, unpaidDebtors } from "./order-payment-service";

const now = { date: "2026-09-29", time: "12:00" };

function stage({ close = true } = {}) {
  const db = makeTestDb();
  const who = (name: string) => ({ id: createEmployee(db, { displayName: name }).id, isAdmin: false });
  const anya = who("Аня"), igor = who("Игорь"), mark = who("Марк"), lena = who("Лена");
  const order = createOrder(db, { createdBy: anya.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null, closesAt: null, recipientIds: [anya.id, igor.id, mark.id, lena.id] });
  addCustomItem(db, order, anya.id, { name: "Суп", price: 200, qty: 1 }, now);
  addCustomItem(db, order, igor.id, { name: "Шаурма", price: 350, qty: 1 }, now);
  addCustomItem(db, order, mark.id, { name: "Чай", price: 50, qty: 1 }, now);
  if (close) closeOrder(db, order, anya);
  return { db, anya, igor, mark, lena, order: getOrder(db, order.id)! };
}

describe("кто сдал", () => {
  it("должники — все с позициями, кроме запускающего; отказавшийся и молчавший — нет", () => {
    const { db, order } = stage();
    expect(orderPayments(db, order).rows.map((r) => r.displayName)).toEqual(["Игорь", "Марк"]);
    expect(unpaidDebtors(db, order).map((d) => d.amount)).toEqual([350, 50]);
  });

  it("должник отмечает себя; повтор не даёт «3 из 2» и не считается новым изменением", () => {
    const { db, igor, order } = stage();
    expect(setOrderPaid(db, order, igor.id, igor, true)).toEqual({ ok: true, changed: true });
    expect(setOrderPaid(db, order, igor.id, igor, true)).toEqual({ ok: true, changed: false });
    expect(orderPayments(db, order).paidCount).toBe(1);
  });

  it("за другого отмечает только управляющий — наличка в руки", () => {
    const { db, anya, igor, mark, order } = stage();
    expect(setOrderPaid(db, order, mark.id, igor, true)).toEqual({ ok: false, error: "Отметить за другого может только тот, кто собирает заказ." });
    expect(setOrderPaid(db, order, mark.id, anya, true)).toEqual({ ok: true, changed: true });
    expect(orderPayments(db, order).rows.find((r) => r.displayName === "Марк")!.markedByAdmin).toBe(true);
  });

  it("пока приём идёт — рано; не должник — отказ", () => {
    const open = stage({ close: false });
    expect(setOrderPaid(open.db, open.order, open.igor.id, open.igor, true)).toEqual({ ok: false, error: "Сдавать рано: приём ещё идёт." });
    const { db, anya, lena, order } = stage();
    expect(setOrderPaid(db, order, lena.id, anya, true)).toEqual({ ok: false, error: "Этот человек ничего не должен." });
    expect(setOrderPaid(db, order, anya.id, anya, true)).toEqual({ ok: false, error: "Этот человек ничего не должен." });
  });

  it("снять чужую отметку участник не может, управляющий — может", () => {
    const { db, anya, igor, mark, order } = stage();
    setOrderPaid(db, order, mark.id, anya, true);
    expect(setOrderPaid(db, order, mark.id, igor, false).ok).toBe(false);
    expect(setOrderPaid(db, order, mark.id, mark, false)).toEqual({ ok: false, error: "Снять отметку может тот, кто её поставил." });
    expect(setOrderPaid(db, order, mark.id, anya, false)).toEqual({ ok: true, changed: true });
  });

  it("снять уже снятую (или никогда не стоявшую) отметку — ok, но changed: false", () => {
    const { db, anya, mark, order } = stage();
    expect(setOrderPaid(db, order, mark.id, anya, false)).toEqual({ ok: true, changed: false });
  });
});
