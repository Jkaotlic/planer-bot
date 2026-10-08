import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import type { Db } from "../db/client";
import { archivePlace, createPlace } from "./place-service";
import { addCustomItem, addMenuItem, closeOrder, createOrder, declineOrder, getOrder } from "./order-service";
import { formatMoney } from "@planer/shared";
import { finishOrderMessages, orderHeading, orderMenu, redrawOrderMessage, remindUnpaid, sendOrderInvites } from "./order-messenger";

const now = { date: "2026-09-29", time: "12:00" };
const URL = "https://example.com";

function person(db: Db, name: string, tg: number) {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  linkTelegramAccount(db, `inv-${name}`, tg);
  return { id: e.id, isAdmin: false };
}

function stage() {
  const db = makeTestDb();
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  const mark = person(db, "Марк", 102);
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }, { name: "Чай", price: 50, unit: "pcs", stepGrams: null }] }, anya.id);
  const order = createOrder(db, { createdBy: anya.id, placeId: place.id, title: null, allowCustom: true, note: null, payHint: "Наличкой мне", closesAt: "2026-09-29T12:30", recipientIds: [anya.id, igor.id, mark.id] });
  return { db, anya, igor, mark, place, order };
}

const labels = (m: { reply_markup?: { inline_keyboard?: { text: string }[][] } }) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text);

describe("рассылка заказа", () => {
  it("письмо с блюдами меню, «Своё блюдо», «Убрать», «Не буду»; у запускающего — «Закрыть приём»", async () => {
    const { db, order } = stage();
    const { bot } = silentBot();
    const api = recordApi(bot);
    expect(await sendOrderInvites(bot, db, order, now, URL)).toBe(3);
    const toIgor = api.sent.find((m) => m.chat_id === 101)!;
    expect(toIgor.text).toContain("🍱 Аня собирает заказ: Шаурмечная");
    // `formatMoney` разделяет число и ₽ неразрывным пробелом ( ) — то же
    // самое, что в `collection.ts`, и здесь сравнение должно это учитывать.
    expect(labels(toIgor)).toEqual(["Шаурма · 350 ₽", "Чай · 50 ₽", "✍️ Своё блюдо", "↩️ Убрать", "🙅 Не буду"]);
    expect(labels(api.sent.find((m) => m.chat_id === 100)!)).toContain("🔒 Закрыть приём");
  });

  it("сбор без своих позиций — в письме нет «✍️ Своё блюдо», кг-кнопка с шагом, заголовок — название", async () => {
    const { db, anya, igor } = stage();
    const place = createPlace(db, { name: "Икра", menu: [{ name: "Икра кетовая", price: 2400, unit: "kg", stepGrams: 400 }] }, anya.id);
    const order = createOrder(db, { createdBy: anya.id, placeId: place.id, title: "Икра, 09.10", allowCustom: false, note: null, payHint: null, closesAt: "2026-09-29T12:30", recipientIds: [anya.id, igor.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    await sendOrderInvites(bot, db, order, now, URL);
    const toIgor = api.sent.find((m) => m.chat_id === 101)!;
    expect(toIgor.text.split("\n")[0]).toBe("🛒 Аня собирает: Икра, 09.10");
    expect(labels(toIgor)).toEqual([`Икра кетовая · 0,4 кг · ${formatMoney(2400)}`, "↩️ Убрать", "🙅 Не буду"]);
    expect(labels(api.sent.find((m) => m.chat_id === 100)!)).toContain("🔒 Закрыть приём");
  });

  it("итог закупки — «Кто что» с весом; отмена и напоминание называют сбор по названию", async () => {
    const { db, anya, igor } = stage();
    const place = createPlace(db, { name: "Икра", menu: [{ name: "Икра кетовая", price: 2400, unit: "kg", stepGrams: 400 }] }, anya.id);
    const order = createOrder(db, { createdBy: anya.id, placeId: place.id, title: "Икра, 09.10", allowCustom: false, note: null, payHint: null, closesAt: "2026-09-29T12:30", recipientIds: [anya.id, igor.id] });
    for (let i = 0; i < 3; i += 1) addMenuItem(db, order, igor.id, place.menu[0]!.id, now);
    closeOrder(db, order, anya);
    const { bot } = silentBot();
    const api = recordApi(bot);
    await finishOrderMessages(bot, db, getOrder(db, order.id)!, "closed", URL);
    const summary = api.sent.find((m) => m.chat_id === 100)!;
    expect(summary.text).toContain("Икра, 09.10");
    expect(summary.text).toContain("Кто что:");
    expect(summary.text).toContain("(1,2 кг)");
    expect(api.sent.find((m) => m.text.startsWith("💸"))!.text).toContain("Икра, 09.10");
    const cancelBot = silentBot().bot;
    const cancelApi = recordApi(cancelBot);
    await finishOrderMessages(cancelBot, db, { ...order, cancelledAt: new Date() }, "cancelled", URL);
    expect(cancelApi.sent.every((m) => m.text === "🚫 Сбор «Икра, 09.10» отменён.")).toBe(true);
    const remindBot = silentBot().bot;
    const remindApi = recordApi(remindBot);
    await remindUnpaid(remindBot, db, getOrder(db, order.id)!);
    expect(remindApi.sent[0]!.text).toContain("«Икра, 09.10»");
  });

  it("при закрытии: сводка запускающему, «сдай» только должникам — не ему и не отказавшимся", async () => {
    const { db, anya, igor, mark, place, order } = stage();
    addMenuItem(db, order, anya.id, place.menu[0]!.id, now);
    addMenuItem(db, order, igor.id, place.menu[0]!.id, now);
    addCustomItem(db, order, igor.id, { name: "Суп", price: 200, qty: 1 }, now);
    // Марк заказывал, но передумал и отказался — долга у него быть не должно.
    addMenuItem(db, order, mark.id, place.menu[0]!.id, now);
    declineOrder(db, order, mark.id, now);
    closeOrder(db, order, anya);
    const { bot } = silentBot();
    const api = recordApi(bot);
    await finishOrderMessages(bot, db, getOrder(db, order.id)!, "closed", URL);
    const summary = api.sent.filter((m) => m.chat_id === 100);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.text).toContain("Что заказать:");
    expect(labels(summary[0]!)).toEqual(["⏰ Напомнить не сдавшим"]);
    const pay = api.sent.filter((m) => m.text.startsWith("💸"));
    expect(pay.map((m) => m.chat_id)).toEqual([101]);
    expect(pay[0]!.text).toContain("Сдай 550 ₽ — Аня");
    expect(labels(pay[0]!)).toEqual(["💸 Я сдал"]);
  });

  it("отмена — всем «Заказ отменён», никаких «сдай»", async () => {
    const { db, anya, order } = stage();
    const { bot } = silentBot();
    const api = recordApi(bot);
    await finishOrderMessages(bot, db, { ...order, cancelledAt: new Date() }, "cancelled", URL);
    // Место стоит МЕЖДУ «Заказ» и «отменён» («Заказ из «Шаурмечная» отменён») —
    // поэтому смотрим не на слитную фразу, а на форму «Заказ … отменён» (то же,
    // что в решении ревью для HTTP-теста).
    expect(api.sent.map((m) => m.text).every((t) => t.startsWith("🚫 Заказ") && t.includes("отменён"))).toBe(true);
    expect(api.sent).toHaveLength(3);
    void anya;
  });

  it("место архивировали посреди приёма — меню в письме не пустеет", () => {
    // Решение ревью: `orderMenu` обязан читать `menuForOrder` (активные блюда места
    // вне зависимости от архивации самого места), а не `getPlaceView(...).menu` —
    // иначе `getPlaceView` вернёт null для архивного места, и меню в письме
    // разъедется с тем, что реально принимают кнопки (`activeMenuItem`).
    const { db, place, order } = stage();
    archivePlace(db, place.id);
    expect(orderMenu(db, order).map((m) => m.name)).toEqual(["Шаурма", "Чай"]);
  });
});

describe("длинная сводка запускающему", () => {
  it("больше 4000 знаков — несколькими письмами по границам строк; «Напомнить» — под последним", async () => {
    const { db, anya, igor, mark, order } = stage();
    // 2 × 20 позиций со 150-знаковыми названиями — сводка далеко за лимит
    // Telegram (4096): одним письмом она бы не ушла вовсе.
    for (const who of [igor, mark]) {
      for (let i = 0; i < 20; i += 1) addCustomItem(db, order, who.id, { name: `${who.id}-${i} ${"щ".repeat(150)}`, price: 100, qty: 1 }, now);
    }
    closeOrder(db, order, anya);
    const { bot } = silentBot();
    const api = recordApi(bot);
    await finishOrderMessages(bot, db, getOrder(db, order.id)!, "closed", URL);
    const summary = api.sent.filter((m) => m.chat_id === 100);
    expect(summary.length).toBeGreaterThan(1);
    for (const m of summary) expect(m.text.length).toBeLessThanOrEqual(4000);
    expect(summary[0]!.text.startsWith("📋 Заказ")).toBe(true);
    expect(summary.at(-1)!.text).toContain("Итого:");
    expect(summary.map(labels)).toEqual([...summary.slice(1).map(() => []), ["⏰ Напомнить не сдавшим"]]);
  });
});

describe("перерисовка письма заказа", () => {
  it("открытый — правит письмо именно этого человека; закрытый — не трогает (кнопки уже погашены)", async () => {
    const { db, anya, igor, order } = stage();
    const { bot } = silentBot();
    const api = recordApi(bot);
    await sendOrderInvites(bot, db, order, now, URL);
    addCustomItem(db, order, igor.id, { name: "Суп", price: 280, qty: 1 }, now);
    await redrawOrderMessage(bot, db, order, igor.id, now, URL);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits).toHaveLength(1);
    expect(edits[0]!.payload.chat_id).toBe(101);
    expect(edits[0]!.payload.text).toContain("Суп");
    closeOrder(db, order, anya);
    await redrawOrderMessage(bot, db, getOrder(db, order.id)!, igor.id, now, URL);
    expect(api.calls.filter((c) => c.method === "editMessageText")).toHaveLength(1);
  });
});

describe("заголовок заказа", () => {
  it("название, иначе место, иначе null", () => {
    const { db, anya, place, order } = stage();
    expect(orderHeading(db, order)).toBe("Шаурмечная");
    expect(orderHeading(db, { ...order, title: "Икра, 09.10" })).toBe("Икра, 09.10");
    const free = createOrder(db, { createdBy: anya.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null, closesAt: null, recipientIds: [anya.id] });
    expect(orderHeading(db, free)).toBeNull();
    void place;
  });
});
