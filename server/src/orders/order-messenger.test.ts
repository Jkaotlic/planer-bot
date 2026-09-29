import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import type { Db } from "../db/client";
import { archivePlace, createPlace } from "./place-service";
import { addCustomItem, addMenuItem, closeOrder, createOrder, declineOrder, getOrder } from "./order-service";
import { finishOrderMessages, orderMenu, sendOrderInvites } from "./order-messenger";

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
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }, { name: "Чай", price: 50 }] }, anya.id);
  const order = createOrder(db, { createdBy: anya.id, placeId: place.id, note: null, payHint: "Наличкой мне", closesAt: "2026-09-29T12:30", recipientIds: [anya.id, igor.id, mark.id] });
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
    const pay = api.sent.filter((m) => m.text.startsWith("💸"));
    expect(pay.map((m) => m.chat_id)).toEqual([101]);
    expect(pay[0]!.text).toContain("Сдай 550 ₽ — Аня");
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
