import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createBot, FALLBACK_TEXT } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { BTN_SERVICES, LEGACY_BTN_FOOD } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { cancelPoll, castVote, closePoll, createPoll, getPoll, voteOf } from "../polls/poll-service";
import { createPlace } from "../orders/place-service";
import { addCustomItem, addMenuItem, cancelOrder, closeOrder, createOrder, getOrder, itemsOf } from "../orders/order-service";
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
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350, unit: "pcs", stepGrams: null }] }, anya.id);
  const order = createOrder(db, {
    createdBy: anya.id, placeId: place.id, title: null, allowCustom: true, note: null, payHint: null, closesAt: null, recipientIds: [anya.id, igor.id],
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

/**
 * Рассылка из обработчика идёт в фоне (не держит очередь апдейтов grammY), и
 * тест, который смотрит на её результат, должен дождаться хвоста сам.
 */
async function flush() {
  for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r));
}

/**
 * Задвижка на `sendMessage`: всё, что бот шлёт, ждёт `release()`. Ставится
 * ПОСЛЕ `recordApi` — последний установленный трансформер grammY внешний, так
 * что запись в `api.sent` появляется только после открытия задвижки.
 */
function gateSends(bot: Bot) {
  let release!: () => void;
  const opened = new Promise<void>((r) => { release = r; });
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "sendMessage") await opened;
    return prev(method, payload, signal);
  });
  return { release };
}

/** Тап, который не дождался ответа за 300 мс, — «повис»: обработчик держит очередь. */
async function tapSettles(bot: Bot, from: number, data: string): Promise<"done" | "hung"> {
  return Promise.race([
    tap(bot, from, data).then(() => "done" as const),
    new Promise<"hung">((r) => setTimeout(() => r("hung"), 300)),
  ]);
}

async function say(bot: Bot, from: number, text: string) {
  await bot.handleUpdate({
    update_id: updateId++,
    message: { message_id: updateId, from: { id: from, is_bot: false, first_name: "T" }, chat: { id: from, first_name: "T", type: "private" as const }, date: 1_712_803_046, text },
  } as never);
}

describe("кнопка «🧰 Сервисы»", () => {
  it("отвечает списком идущего, вход в «Сервисы» первым и прежние кнопки заказов", async () => {
    const { bot } = stage();
    const api = recordApi(bot);
    await say(bot, 333, BTN_SERVICES);
    const reply = api.sent.at(-1)!;
    expect(reply.text).toContain("Пицца?");
    expect(reply.text).toContain("пришли ссылку");
    const buttons = (reply.reply_markup?.inline_keyboard ?? []).flat() as { text: string; web_app?: { url: string } }[];
    expect(buttons.map((b) => b.text)).toEqual(["🧰 Открыть Сервисы", "🍱 Новый заказ", "🗳 Новый опрос", "📋 Заказы и опросы"]);
    expect(buttons[0]!.web_app!.url).toBe("https://example.com/app/?screen=services");
    expect(buttons[2]!.web_app!.url).toBe("https://example.com/app/?screen=orders&new=poll");
  });

  // Keyboards already on people's phones still say «🍱 Заказы» until the next /start.
  it("старая подпись «🍱 Заказы» из висящей клавиатуры открывает то же меню, а не заглушку", async () => {
    const { bot } = stage();
    const api = recordApi(bot);
    await say(bot, 333, LEGACY_BTN_FOOD);
    const reply = api.sent.at(-1)!;
    expect(reply.text).not.toBe(FALLBACK_TEXT);
    expect((reply.reply_markup?.inline_keyboard ?? []).flat().map((b) => b.text)[0]).toBe("🧰 Открыть Сервисы");
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
    await flush();
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
    const closedEntry = listRecentAudit(db, 10).find((row) => row.type === "poll_closed");
    expect(closedEntry?.actorEmployeeId).toBe(anya.id);
    expect(closedEntry?.payload).toMatchObject({ pollId: poll.id, question: poll.question });

    await flush();
    // Повторный тап уже закрывшего — «Опрос уже закрыт.», без второй рассылки итога.
    await tap(bot, 111, `poll:close:${poll.id}`);
    await flush();
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
    await flush();
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    const summaryCount = api.sent.filter((m) => m.text.includes("Что заказать:")).length;
    expect(summaryCount).toBe(1);
    await tap(bot, 111, `order:close:${order.id}`);
    await flush();
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

  it("кнопка «🧰 Сервисы» показывает и заказы, и опросы", async () => {
    const { bot } = stage();
    const api = recordApi(bot);
    await say(bot, 333, BTN_SERVICES);
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

  it("двойной тап «Я сдал» не снимает отметку — paidCount остаётся 1", async () => {
    const { db, bot, anya, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    closeOrder(db, order, anya);
    recordApi(bot);
    await tap(bot, 333, `order:paid:${order.id}`);
    await tap(bot, 333, `order:paid:${order.id}`);
    expect(orderPayments(db, getOrder(db, order.id)!).paidCount).toBe(1);
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

  it("«Напомнить» на отменённом заказе — «Заказ отменён — напоминать не о чем.», раньше проверки «закрыт ли»", async () => {
    const { db, bot, anya, order } = stage();
    cancelOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 111, `order:remind:${order.id}`);
    expect(api.answers.at(-1)).toBe("Заказ отменён — напоминать не о чем.");
  });

  it("«Напомнить» пишет в аудит с актором, числом дошедших и записывает недостижимых", async () => {
    const { db, bot, anya, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    closeOrder(db, order, anya);
    recordApi(bot);
    await tap(bot, 111, `order:remind:${order.id}`);
    await flush();
    const entry = listRecentAudit(db, 10).find((row) => row.type === "order_reminded");
    expect(entry?.actorEmployeeId).toBe(anya.id);
    expect(entry?.payload).toMatchObject({ orderId: order.id, delivered: 1, unreachable: 0 });
  });

  it("«Напомнить»: должник без Telegram попадает в «Не дошло: …», дошедший считается отдельно", async () => {
    const { db, bot, anya, igor } = stage();
    // Своя пара получателей: Игорь (с Telegram) и Настя (без) — оба заказали.
    const nastya = createEmployee(db, { displayName: "Настя" });
    const order = createOrder(db, {
      createdBy: anya.id, placeId: null, title: null, allowCustom: true, note: null, payHint: null, closesAt: null,
      recipientIds: [anya.id, igor.id, nastya.id],
    });
    const now = { date: "2026-09-29", time: "12:00" };
    addCustomItem(db, order, igor.id, { name: "Суп", price: 280, qty: 1 }, now);
    addCustomItem(db, order, nastya.id, { name: "Чай", price: 50, qty: 1 }, now);
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 111, `order:remind:${order.id}`);
    // Всплывашку можно показать один раз — и сразу: «Напоминаю…». Итог
    // приходит отдельным письмом тому, кто нажал, когда волна дошла.
    expect(api.answers.at(-1)).toBe("Напоминаю…");
    await flush();
    expect(api.sent.filter((m) => m.chat_id === 111).at(-1)!.text).toBe("Напомнил: 1 из 2. Не дошло: Настя");
  });

  it("второй тап «Напомнить», пока первая рассылка ещё идёт, — «Уже напоминаю — подожди.», письмо уходит одной волной; после волны замок снят", async () => {
    const { db, bot, anya, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    const gate = gateSends(bot);
    // Первая волна висит на задвижке: второй тап застаёт замок (см.
    // `remindInFlight` в food-handlers.ts) — проверяется защита, а не порядок.
    expect(await tapSettles(bot, 111, `order:remind:${order.id}`)).toBe("done");
    await tap(bot, 111, `order:remind:${order.id}`);
    expect(api.answers).toEqual(["Напоминаю…", "Уже напоминаю — подожди."]);
    gate.release();
    await flush();
    expect(api.sent.filter((m) => m.text.startsWith("⏰"))).toHaveLength(1);
    // Замок снимается в конце фоновой волны, а не навсегда.
    await tap(bot, 111, `order:remind:${order.id}`);
    await flush();
    expect(api.answers.at(-1)).toBe("Напоминаю…");
    expect(api.sent.filter((m) => m.text.startsWith("⏰"))).toHaveLength(2);
  });

  it("«Напомнить», когда все сдали, — «Все уже сдали 🎉» сразу, без волны", async () => {
    const { db, bot, anya, order } = stage();
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    await tap(bot, 111, `order:remind:${order.id}`);
    await flush();
    expect(api.answers.at(-1)).toBe("Все уже сдали 🎉");
    expect(api.sent).toHaveLength(0);
  });
});

/**
 * Один процесс — и API, и long-polling, а grammY разбирает апдейты строго по
 * одному: обработчик, который ждёт рассылку на всю команду, держит все кнопки
 * всех людей (см. историю в `api-timeouts.ts`). Задвижка на `sendMessage`
 * имитирует медленную сеть: тап должен ответить, не дожидаясь волны.
 */
describe("массовые рассылки не держат очередь апдейтов", () => {
  it("«Закрыть опрос» отвечает до конца рассылки итога; итог уходит, когда сеть отпустило", async () => {
    const { db, bot, poll } = stage();
    const api = recordApi(bot);
    const gate = gateSends(bot);
    expect(await tapSettles(bot, 111, `poll:close:${poll.id}`)).toBe("done");
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent).toHaveLength(0);
    gate.release();
    await vi.waitFor(() => expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2));
  });

  it("«Закрыть приём» отвечает до конца рассылки сводки; сводка уходит, когда сеть отпустило", async () => {
    const { db, bot, order } = stage();
    const api = recordApi(bot);
    const gate = gateSends(bot);
    expect(await tapSettles(bot, 111, `order:close:${order.id}`)).toBe("done");
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    expect(api.sent).toHaveLength(0);
    gate.release();
    await vi.waitFor(() => expect(api.sent.filter((m) => m.text.includes("Что заказать:"))).toHaveLength(1));
  });

  it("«Напомнить» отвечает «Напоминаю…» до конца волны; итог и аудит — после", async () => {
    const { db, bot, anya, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    closeOrder(db, order, anya);
    const api = recordApi(bot);
    const gate = gateSends(bot);
    expect(await tapSettles(bot, 111, `order:remind:${order.id}`)).toBe("done");
    expect(api.answers.at(-1)).toBe("Напоминаю…");
    gate.release();
    await vi.waitFor(() => expect(api.sent.some((m) => m.chat_id === 111 && m.text === "Напомнил: 1 из 1")).toBe(true));
    expect(api.sent.filter((m) => m.chat_id === 333 && m.text.startsWith("⏰"))).toHaveLength(1);
    expect(listRecentAudit(db, 10).find((row) => row.type === "order_reminded")?.payload).toMatchObject({ delivered: 1 });
  });
});

/**
 * Telegram отказывается принять ответ на тап (сеть, запрос старше 15 минут).
 * Ставится ПОСЛЕ `recordApi`, чтобы отказ случился раньше записи.
 */
function failAnswers(bot: Bot) {
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "answerCallbackQuery") throw new Error("query is too old");
    return prev(method, payload, signal);
  });
}

describe("закрытие, когда Telegram не принял ответ на тап", () => {
  it("опрос: закрыт, и итог всё равно уходит адресатам", async () => {
    const { db, bot, poll } = stage();
    const api = recordApi(bot);
    failAnswers(bot);
    await tap(bot, 111, `poll:close:${poll.id}`).catch(() => {});
    await flush();
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
  });

  it("заказ: закрыт, и сводка всё равно уходит тому, кто собирал", async () => {
    const { db, bot, igor, order, shawarmaId } = stage();
    addMenuItem(db, order, igor.id, shawarmaId, { date: "2026-09-29", time: "12:00" });
    const api = recordApi(bot);
    failAnswers(bot);
    await tap(bot, 111, `order:close:${order.id}`).catch(() => {});
    await flush();
    expect(getOrder(db, order.id)!.closedAt).not.toBeNull();
    expect(api.sent.some((m) => m.chat_id === 111 && m.text.includes("Что заказать:"))).toBe(true);
    expect(api.sent.some((m) => m.chat_id === 333 && m.text.startsWith("💸"))).toBe(true);
  });
});
