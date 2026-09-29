import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { BTN_FOOD } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { cancelPoll, castVote, closePoll, createPoll, getPoll, voteOf } from "../polls/poll-service";
import { createPlace } from "../orders/place-service";
import { addMenuItem, cancelOrder, closeOrder, createOrder, getOrder, itemsOf } from "../orders/order-service";
import { orderPayments } from "../orders/order-payment-service";
import { listRecentAudit } from "../repo/audit";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();
let updateId = 1;

function person(db: Db, name: string, tg: number) {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${tg}` });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  return { id: e.id, isAdmin: false };
}

function stage() {
  const db = makeTestDb();
  const anya = person(db, "Аня", 111);
  const igor = person(db, "Игорь", 333);
  const mark = person(db, "Марк", 444);
  const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id] });
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] }, anya.id);
  const order = createOrder(db, {
    createdBy: anya.id, placeId: place.id, note: null, payHint: null, closesAt: null, recipientIds: [anya.id, igor.id],
  });
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, anya, igor, mark, poll, order, shawarmaId: place.menu[0]!.id };
}

/** Отдельно от `person()`: этому человеку нужен `isAdmin` в базе, а не просто
 *  связанный Telegram, чтобы закрыть чужой приём. */
function admin(db: Db, name: string, tg: number) {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${tg}`, isAdmin: true });
  linkTelegramAccount(db, `inv-${tg}`, tg);
  return { id: e.id, isAdmin: true };
}

async function tap(bot: Bot, from: number, data: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    callback_query: {
      id: String(updateId), from: { id: from, is_bot: false, first_name: "T" }, chat_instance: "1", data,
      message: { message_id: updateId, date: Math.floor(Date.now() / 1000), chat: { id: from, type: "private" }, from: { id: 1, is_bot: true, first_name: "P" }, text: "…" },
    },
  } as never);
}

async function say(bot: Bot, from: number, text: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: { message_id: updateId, from: { id: from, is_bot: false, first_name: "T" }, chat: { id: from, first_name: "T", type: "private" as const }, date: 1_712_803_046, text },
  } as never);
}

describe("кнопка «🍱 Заказы»", () => {
  it("отвечает списком идущего и кнопками мини-аппа", async () => {
    const { bot } = stage();
    const api = recordApi(bot);
    await say(bot, 333, BTN_FOOD);
    const reply = api.sent.at(-1)!;
    expect(reply.text).toContain("Пицца?");
    const buttons = (reply.reply_markup?.inline_keyboard ?? []).flat() as { text: string; web_app?: { url: string } }[];
    expect(buttons.map((b) => b.text)).toEqual(["🍱 Новый заказ", "🗳 Новый опрос", "📋 Открыть"]);
    expect(buttons[1]!.web_app!.url).toBe("https://example.com/app/?screen=orders&new=poll");
  });
});

describe("колбэки опроса", () => {
  it("голос ставится, письмо перерисовывается с отметкой", async () => {
    const { db, bot, igor, poll } = stage();
    const api = recordApi(bot);
    await tap(bot, 333, `poll:v:${poll.id}:for`);
    expect(voteOf(db, poll.id, igor.id)).toBe("for");
    expect(api.answers.join(" ")).toMatch(/Голос принят/);
    const edit = api.calls.find((c) => c.method === "editMessageText")!;
    expect(edit.payload.text).toContain("Твой голос: 👍 За");
  });

  it("посторонний с пересланной кнопкой получает отказ и ничего не пишет в базу", async () => {
    const { db, bot, mark, poll } = stage();
    const api = recordApi(bot);
    await tap(bot, 444, `poll:v:${poll.id}:for`);
    expect(voteOf(db, poll.id, mark.id)).toBeNull();
    expect(api.answers.join(" ")).toMatch(/не приходил/);
  });

  it("тап в закрытом опросе — «Опрос закрыт»", async () => {
    const { db, bot, anya, igor, poll } = stage();
    closePoll(db, poll, anya);
    const api = recordApi(bot);
    await tap(bot, 333, `poll:v:${poll.id}:against`);
    expect(voteOf(db, poll.id, igor.id)).toBeNull();
    expect(api.answers.join(" ")).toMatch(/Опрос закрыт/);
  });

  it("голос на отменённом опросе — «Опрос закрыт.», без записи в базу", async () => {
    const { db, bot, anya, igor, poll } = stage();
    cancelPoll(db, poll, anya);
    const api = recordApi(bot);
    await tap(bot, 333, `poll:v:${poll.id}:for`);
    expect(voteOf(db, poll.id, igor.id)).toBeNull();
    expect(api.answers.join(" ")).toMatch(/Опрос закрыт\./);
  });

  it("«Итоги» показывает счёт всплывашкой", async () => {
    const { db, bot, igor, poll } = stage();
    castVote(db, poll, igor.id, "for", { date: "2026-09-29", time: "12:00" });
    const api = recordApi(bot);
    await tap(bot, 333, `poll:r:${poll.id}`);
    expect(api.answers.join(" ")).toMatch(/За 1 · Против 0 · Воздержались 0 · Молчат 1/);
  });

  it("«Закрыть опрос» у запускающего закрывает и рассылает итог, у участника — отказ", async () => {
    const { db, bot, anya, poll } = stage();
    const api = recordApi(bot);
    // Участник (не запускающий, не админ) — отказ, без изменений в базе.
    await tap(bot, 333, `poll:close:${poll.id}`);
    expect(getPoll(db, poll.id)!.closedAt).toBeNull();
    expect(api.answers.join(" ")).toMatch(/Закрыть может только тот, кто запустил опрос\./);

    // Запускающий — закрывает, итог уходит обоим адресатам, и это попадает в аудит.
    await tap(bot, 111, `poll:close:${poll.id}`);
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
    const closedEntry = listRecentAudit(db, 10).find((row) => row.type === "poll_closed");
    expect(closedEntry?.actorEmployeeId).toBe(anya.id);
    expect(closedEntry?.payload).toMatchObject({ pollId: poll.id, question: poll.question });

    // Повторный тап уже закрывшего — «Опрос уже закрыт.», без второй рассылки итога.
    await tap(bot, 111, `poll:close:${poll.id}`);
    expect(api.answers.join(" ")).toMatch(/Опрос уже закрыт\./);
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
  });
});

describe("колбэки заказа", () => {
  it("тап по блюду добавляет позицию и перерисовывает письмо с «Твой заказ»", async () => {
    const { db, bot, igor, order, shawarmaId } = stage();
    const api = recordApi(bot);
    await tap(bot, 333, `order:add:${order.id}:${shawarmaId}`);
    expect(itemsOf(db, order.id).map((i) => [i.employeeId, i.qty])).toEqual([[igor.id, 1]]);
    expect(api.answers.join(" ")).toMatch(/Шаурма/);
    expect(api.calls.find((c) => c.method === "editMessageText")!.payload.text).toContain("Твой заказ:");
  });

  it("«Убрать» и «Не буду» работают; посторонний получает отказ", async () => {
    const { db, bot, order, shawarmaId } = stage();
    const api = recordApi(bot);
    await tap(bot, 333, `order:add:${order.id}:${shawarmaId}`);
    await tap(bot, 333, `order:undo:${order.id}`);
    expect(itemsOf(db, order.id)).toEqual([]);
    await tap(bot, 333, `order:no:${order.id}`);
    expect(api.calls.filter((c) => c.method === "editMessageText").at(-1)!.payload.text).toContain("Ты не заказываешь");
    await tap(bot, 444, `order:add:${order.id}:${shawarmaId}`);
    expect(api.answers.at(-1)).toMatch(/не приходил/);
  });

  it("«Закрыть приём» — только запускающему; после закрытия тап по блюду отвечает «Приём закрыт»", async () => {
    const { db, bot, order, shawarmaId } = stage();
    const api = recordApi(bot);
    await tap(bot, 333, `order:close:${order.id}`);
    expect(getOrder(db, order.id)!.closedAt).toBeNull();
    await tap(bot, 111, `order:close:${order.id}`);
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    await tap(bot, 333, `order:add:${order.id}:${shawarmaId}`);
    expect(api.answers.at(-1)).toMatch(/Приём закрыт/);
    expect(itemsOf(db, order.id)).toEqual([]);
  });

  it("«Закрыть приём» пишет в аудит с актором и именем места", async () => {
    const { db, bot, anya, order } = stage();
    recordApi(bot);
    await tap(bot, 111, `order:close:${order.id}`);
    const entry = listRecentAudit(db, 10).find((row) => row.type === "order_closed");
    expect(entry?.actorEmployeeId).toBe(anya.id);
    expect(entry?.payload).toMatchObject({ orderId: order.id, placeName: "Шаурмечная" });
  });

  it("повторный тап «Закрыть приём» запускающим — «Приём уже закрыт.», без второй сводки", async () => {
    const { db, bot, order } = stage();
    const api = recordApi(bot);
    await tap(bot, 111, `order:close:${order.id}`);
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    const summaryCount = api.sent.filter((m) => m.text.includes("Что заказать:")).length;
    await tap(bot, 111, `order:close:${order.id}`);
    expect(api.answers.at(-1)).toMatch(/Приём уже закрыт\./);
    expect(api.sent.filter((m) => m.text.includes("Что заказать:"))).toHaveLength(summaryCount);
  });

  it("админ закрывает чужой приём — «сводка ушла тому, кто собирал заказ»", async () => {
    const { db, bot, order } = stage();
    const lena = admin(db, "Лена", 555);
    const api = recordApi(bot);
    await tap(bot, 555, `order:close:${order.id}`);
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    expect(api.answers.at(-1)).toBe("Приём закрыт, сводка ушла тому, кто собирал заказ");
    const entry = listRecentAudit(db, 10).find((row) => row.type === "order_closed");
    expect(entry?.actorEmployeeId).toBe(lena.id);
  });

  it("тап по блюду в отменённом заказе — «Приём закрыт»", async () => {
    const { db, bot, anya, order, shawarmaId } = stage();
    cancelOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 333, `order:add:${order.id}:${shawarmaId}`);
    expect(api.answers.join(" ")).toMatch(/Приём закрыт/);
    expect(itemsOf(db, order.id)).toEqual([]);
  });

  it("кнопка «🍱 Заказы» показывает и заказы, и опросы", async () => {
    const { bot } = stage();
    const api = recordApi(bot);
    await say(bot, 333, BTN_FOOD);
    const text = api.sent.at(-1)!.text;
    expect(text).toContain("🍱 Аня: Шаурмечная");
    expect(text).toContain("🗳 Пицца?");
  });
});

describe("деньги заказа в боте", () => {
  it("«Я сдал» после закрытия ставит отметку и меняет кнопку", async () => {
    const { db, bot, anya, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 333, `order:paid:${order.id}`);
    expect(orderPayments(db, getOrder(db, order.id)!).paidCount).toBe(1);
    expect(api.calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("«Напомнить» от участника — отказ", async () => {
    const { db, bot, anya, order } = stage();
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 333, `order:remind:${order.id}`);
    expect(api.answers.at(-1)).toMatch(/только тот, кто собирает/);
  });

  it("«Напомнить» до закрытия приёма — «Сначала закрой приём.»", async () => {
    const { bot, order } = stage();
    const api = recordApi(bot);
    await tap(bot, 111, `order:remind:${order.id}`);
    expect(api.answers.at(-1)).toBe("Сначала закрой приём.");
  });
});
