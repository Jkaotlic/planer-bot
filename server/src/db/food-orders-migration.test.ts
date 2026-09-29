import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { createEmployee } from "../repo/employees";
import { foodOrderDeclines, foodOrderItems, foodOrderPayments, foodOrderRecipients, foodOrders } from "./schema";

describe("миграция 0039 — заказы еды", () => {
  it("заказ без места, позиция без блюда меню, отказ и отметка о сдаче сохраняются", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    const order = db.insert(foodOrders).values({ createdBy: anya.id }).returning().get();
    expect(order.placeId).toBeNull();
    db.insert(foodOrderRecipients).values({ orderId: order.id, employeeId: igor.id }).run();
    db.insert(foodOrderItems).values({ orderId: order.id, employeeId: igor.id, name: "Шаурма", price: 350, qty: 1 }).run();
    db.insert(foodOrderDeclines).values({ orderId: order.id, employeeId: anya.id }).run();
    db.insert(foodOrderPayments).values({ orderId: order.id, employeeId: igor.id, markedBy: igor.id }).run();
    expect(() => db.insert(foodOrderPayments).values({ orderId: order.id, employeeId: igor.id, markedBy: anya.id }).run()).toThrow(/UNIQUE/i);
    expect(() => db.insert(foodOrderDeclines).values({ orderId: order.id, employeeId: anya.id }).run()).toThrow(/UNIQUE|PRIMARY/i);
  });
});
