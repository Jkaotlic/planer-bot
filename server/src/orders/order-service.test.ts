import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { archivePlace, createPlace, updatePlace } from "./place-service";
import {
  addCustomItem, addMenuItem, cancelOrder, closeDueOrders, closeOrder, createOrder, declineOrder, getOrder,
  itemsOf, listOrdersFor, orderView, removeItem, removeLastItem, setItemQty,
} from "./order-service";
import { FOOD_ITEMS_PER_PERSON_MAX, debtOf } from "@planer/shared";

const now = { date: "2026-09-29", time: "12:00" };

function stage(closesAt: string | null = null) {
  const db = makeTestDb();
  const anya = { id: createEmployee(db, { displayName: "Аня" }).id, isAdmin: false };
  const igor = { id: createEmployee(db, { displayName: "Игорь" }).id, isAdmin: false };
  const mark = { id: createEmployee(db, { displayName: "Марк" }).id, isAdmin: false };
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }, { name: "Чай", price: 50, unit: "pcs", stepGrams: null }] }, anya.id);
  const order = createOrder(db, { createdBy: anya.id, placeId: place.id, note: null, payHint: null, closesAt, recipientIds: [anya.id, igor.id] });
  const [shawarma, tea] = place.menu;
  return { db, anya, igor, mark, place, order, shawarma: shawarma!, tea: tea! };
}

describe("позиции", () => {
  it("повторный тап по блюду прибавляет количество, а не строку", () => {
    const { db, igor, order, shawarma } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    addMenuItem(db, order, igor.id, shawarma.id, now);
    expect(itemsOf(db, order.id).map((i) => [i.name, i.qty])).toEqual([["Шаурма", 2]]);
  });

  it("правка цены в меню после заказа не меняет долг", () => {
    const { db, igor, order, place, shawarma, tea } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    updatePlace(db, place.id, { name: "Шаурмечная", menu: [{ id: shawarma.id, name: "Шаурма", price: 999, unit: "pcs", stepGrams: null }, { id: tea.id, name: "Чай", price: 50, unit: "pcs", stepGrams: null }] });
    expect(debtOf(itemsOf(db, order.id), igor.id)).toBe(350);
  });

  it("после правки цены тап даёт новую строку с новой ценой — старую не переписывает", () => {
    const { db, igor, order, place, shawarma, tea } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    updatePlace(db, place.id, { name: "Шаурмечная", menu: [{ id: shawarma.id, name: "Шаурма", price: 400, unit: "pcs", stepGrams: null }, { id: tea.id, name: "Чай", price: 50, unit: "pcs", stepGrams: null }] });
    addMenuItem(db, order, igor.id, shawarma.id, now);
    expect(itemsOf(db, order.id).map((i) => [i.price, i.qty])).toEqual([[350, 1], [400, 1]]);
  });

  it("блюдо чужого места или из архива — отказ", () => {
    const { db, anya, igor, order, place, shawarma } = stage();
    const other = createPlace(db, { name: "Додо", menu: [{ name: "Пицца", price: 600, unit: "pcs", stepGrams: null }] }, anya.id);
    expect(addMenuItem(db, order, igor.id, other.menu[0]!.id, now)).toEqual({ ok: false, error: "Этого блюда нет в меню." });
    updatePlace(db, place.id, { name: "Шаурмечная", menu: [] });
    expect(addMenuItem(db, order, igor.id, shawarma.id, now)).toEqual({ ok: false, error: "Этого блюда нет в меню." });
  });

  it("своё блюдо с ценой; количество правится только у своей позиции", () => {
    const { db, anya, igor, order } = stage();
    expect(addCustomItem(db, order, igor.id, { name: "Суп дня", price: 280, qty: 1 }, now)).toEqual({ ok: true });
    const item = itemsOf(db, order.id)[0]!;
    expect(setItemQty(db, order, igor.id, item.id, 3, now)).toEqual({ ok: true });
    expect(setItemQty(db, order, anya.id, item.id, 1, now)).toEqual({ ok: false, error: "Это не твоя позиция." });
    expect(removeItem(db, order, anya.id, item.id, now).ok).toBe(false);
    expect(debtOf(itemsOf(db, order.id), igor.id)).toBe(840);
  });

  it("«Убрать последнее» уменьшает количество, потом удаляет строку", () => {
    const { db, igor, order, shawarma } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    addMenuItem(db, order, igor.id, shawarma.id, now);
    removeLastItem(db, order, igor.id, now);
    expect(itemsOf(db, order.id)[0]!.qty).toBe(1);
    removeLastItem(db, order, igor.id, now);
    expect(itemsOf(db, order.id)).toEqual([]);
    expect(removeLastItem(db, order, igor.id, now)).toEqual({ ok: false, error: "Убирать нечего." });
  });

  it("«Не буду» снимает позиции; новый тап по блюду снимает отказ", () => {
    const { db, anya, igor, order, shawarma } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    declineOrder(db, order, igor.id, now);
    expect(itemsOf(db, order.id)).toEqual([]);
    expect(orderView(db, order, igor, now)!.declined).toBe(true);
    addMenuItem(db, order, igor.id, shawarma.id, now);
    expect(orderView(db, order, igor, now)!.declined).toBe(false);
    expect(orderView(db, order, anya, now)!.respondedCount).toBe(1);
  });

  it("не адресат не может заказать", () => {
    const { db, mark, order, shawarma } = stage();
    expect(addMenuItem(db, order, mark.id, shawarma.id, now)).toEqual({ ok: false, error: "Этот заказ тебе не приходил." });
  });

  it("после срока не может никто, даже если тик ещё не прошёл", () => {
    const { db, igor, order, shawarma } = stage("2026-09-29T11:00");
    expect(addMenuItem(db, order, igor.id, shawarma.id, now)).toEqual({ ok: false, error: "Приём закрыт." });
  });

  it("в заказе без меню блюдо из меню не добавить", () => {
    const { db, anya, igor, shawarma } = stage();
    const free = createOrder(db, { createdBy: anya.id, placeId: null, note: null, payHint: null, closesAt: null, recipientIds: [anya.id, igor.id] });
    expect(addMenuItem(db, free, igor.id, shawarma.id, now)).toEqual({ ok: false, error: "Этого блюда нет в меню." });
  });
});

describe("не больше 20 своих позиций", () => {
  it("21-я своя позиция — отказ «Больше 20 позиций — это уже не обед.»; прибавка к уже взятому блюду — можно", () => {
    const { db, igor, order, shawarma } = stage();
    expect(FOOD_ITEMS_PER_PERSON_MAX).toBe(20);
    expect(addMenuItem(db, order, igor.id, shawarma.id, now)).toEqual({ ok: true });
    for (let i = 1; i < 20; i += 1) expect(addCustomItem(db, order, igor.id, { name: `Блюдо ${i}`, price: 10, qty: 1 }, now)).toEqual({ ok: true });
    const refusal = { ok: false, error: "Больше 20 позиций — это уже не обед." };
    expect(addCustomItem(db, order, igor.id, { name: "Ещё", price: 10, qty: 1 }, now)).toEqual(refusal);
    // Та же шаурма — не новая строка, а ×2: лимит строк её не касается.
    expect(addMenuItem(db, order, igor.id, shawarma.id, now)).toEqual({ ok: true });
    expect(itemsOf(db, order.id).filter((i) => i.employeeId === igor.id)).toHaveLength(20);
  });

  it("новое блюдо из меню 21-й строкой — тоже отказ; чужие строки не считаются", () => {
    const { db, anya, igor, order, tea } = stage();
    for (let i = 0; i < 20; i += 1) addCustomItem(db, order, igor.id, { name: `Блюдо ${i}`, price: 10, qty: 1 }, now);
    expect(addMenuItem(db, order, igor.id, tea.id, now)).toEqual({ ok: false, error: "Больше 20 позиций — это уже не обед." });
    expect(addMenuItem(db, order, anya.id, tea.id, now)).toEqual({ ok: true });
  });
});

describe("закрытие", () => {
  it("закрыть может запускающий, второй раз — отказ; после закрытия позиции не меняются", () => {
    const { db, anya, igor, order, shawarma } = stage();
    expect(closeOrder(db, order, igor).ok).toBe(false);
    expect(closeOrder(db, order, anya)).toEqual({ ok: true });
    expect(closeOrder(db, getOrder(db, order.id)!, anya)).toEqual({ ok: false, error: "Приём уже закрыт." });
    expect(addMenuItem(db, getOrder(db, order.id)!, igor.id, shawarma.id, now)).toEqual({ ok: false, error: "Приём закрыт." });
  });

  it("closeDueOrders закрывает просроченные ровно один раз; отменённые не трогает", () => {
    const { db, anya } = stage("2026-09-29T11:00");
    const cancelled = createOrder(db, { createdBy: anya.id, placeId: null, note: null, payHint: null, closesAt: "2026-09-29T10:00", recipientIds: [anya.id] });
    cancelOrder(db, cancelled, anya);
    expect(closeDueOrders(db, now)).toHaveLength(1);
    expect(closeDueOrders(db, now)).toHaveLength(0);
  });

  it("closeDueOrders не трогает заказ со сроком в будущем и заказ без срока", () => {
    const { db, anya } = stage();
    const future = createOrder(db, { createdBy: anya.id, placeId: null, note: null, payHint: null, closesAt: "2026-09-29T13:00", recipientIds: [anya.id] });
    const noDeadline = createOrder(db, { createdBy: anya.id, placeId: null, note: null, payHint: null, closesAt: null, recipientIds: [anya.id] });
    expect(closeDueOrders(db, now)).toHaveLength(0);
    expect(getOrder(db, future.id)!.closedAt).toBeNull();
    expect(getOrder(db, noDeadline.id)!.closedAt).toBeNull();
  });
});

describe("вид заказа", () => {
  it("участник видит свой заказ и сводку по блюдам, но не список по людям", () => {
    const { db, anya, igor, order, shawarma } = stage();
    addMenuItem(db, order, igor.id, shawarma.id, now);
    const mine = orderView(db, order, igor, now)!;
    expect(mine.myItems.map((i) => i.name)).toEqual(["Шаурма"]);
    expect(mine.myTotal).toBe(350);
    expect(mine.people).toBeNull();
    const boss = orderView(db, order, anya, now)!;
    expect(boss.people).toEqual([
      { employeeId: anya.id, displayName: "Аня", amount: 0, declined: false },
      { employeeId: igor.id, displayName: "Игорь", amount: 350, declined: false },
    ]);
    expect(boss.menu.map((m) => m.name)).toEqual(["Шаурма", "Чай"]);
  });

  it("посторонний не видит заказ", () => {
    const { db, mark, order } = stage();
    expect(orderView(db, order, mark, now)).toBeNull();
  });

  it("место архивировано — заказ всё равно видит меню, и тап по блюду работает", () => {
    const { db, igor, order, place, shawarma } = stage();
    archivePlace(db, place.id);
    expect(orderView(db, order, igor, now)!.menu.map((m) => m.name)).toEqual(["Шаурма", "Чай"]);
    expect(addMenuItem(db, order, igor.id, shawarma.id, now)).toEqual({ ok: true });
  });
});

describe("listOrdersFor", () => {
  it("адресат и создатель-не-адресат видят заказ, посторонний — нет", () => {
    const { db, anya, igor, mark, order } = stage();
    expect(listOrdersFor(db, igor, now).map((v) => v.id)).toContain(order.id);
    const creatorOnly = createOrder(db, { createdBy: anya.id, placeId: null, note: null, payHint: null, closesAt: null, recipientIds: [igor.id] });
    expect(listOrdersFor(db, anya, now).map((v) => v.id)).toContain(creatorOnly.id);
    expect(listOrdersFor(db, mark, now)).toEqual([]);
  });
});
