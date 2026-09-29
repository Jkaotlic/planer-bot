import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";
import { createPlace } from "../../orders/place-service";
import { listRecentAudit } from "../../repo/audit";
import { sql } from "drizzle-orm";
import { foodOrders } from "../../db/schema";

function fakeBot() {
  const sent: { to: number; text: string; id: number }[] = [];
  // Кому доставка отвечает отказом — имитирует заблокированный ботом чат,
  // не требуя настоящей сети: `remindUnpaid` должен положить такого в
  // `unreachable`, а не молча посчитать «дошло».
  const failFor = new Set<number>();
  let nextId = 1;
  // Задвижка «медленной сети»: пока она стоит, каждый `sendMessage` ждёт —
  // рассылка висит внутри запроса, как на обрыве релея.
  let gate: Promise<void> | null = null;
  let waiting = 0;
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => {
        if (gate) { waiting += 1; await gate; }
        if (failFor.has(to)) throw new Error("Forbidden: bot was blocked by the user");
        const id = nextId++;
        sent.push({ to, text, id });
        return { message_id: id };
      }),
      editMessageReplyMarkup: vi.fn(async () => ({})),
      editMessageText: vi.fn(async () => ({})),
    },
  };
  function hold() {
    let release!: () => void;
    gate = new Promise<void>((r) => { release = r; });
    return { release: () => { gate = null; release(); }, waiting: () => waiting };
  }
  return { bot: bot as unknown as Bot, sent, failFor, hold, api: bot.api };
}

const config = testConfig();
const initDataFor = (id: number) =>
  signInitData({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id, first_name: "T" }) }, config.botToken);
const tokenFor = async (app: ReturnType<typeof createApp>, id: number) =>
  (await (await app.request(new Request("http://x/api/auth", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ initData: initDataFor(id) }),
  }))).json()).token as string;
const send = (token: string, body: unknown, method = "POST") => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});
const get = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

function person(db: Db, name: string, tg: number): number {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  linkTelegramAccount(db, `inv-${name}`, tg);
  return e.id;
}

type App = ReturnType<typeof createApp>;

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T09:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

async function stage() {
  const db = makeTestDb();
  const { bot, sent, failFor, hold, api } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  const mark = person(db, "Марк", 102);
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] }, anya);
  return {
    db, app, sent, failFor, hold, api, anya, igor, mark, placeId: place.id,
    anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102),
  };
}

async function newOrder(app: App, token: string, igor: number, placeId: number | null) {
  const res = await app.request(new Request("http://x/api/orders", send(token, {
    placeId, note: null, payHint: "Наличкой мне", closesTime: "12:30", audience: { kind: "picked", employeeIds: [igor] },
  })));
  return { status: res.status, body: await res.json() };
}

/** Та же ручка, но с несколькими адресатами — тестам про деньги нужно больше
 *  одного должника (напомнить одному, а не другому; пометить за конкретного). */
async function newOrderFor(app: App, token: string, employeeIds: number[], placeId: number | null) {
  const res = await app.request(new Request("http://x/api/orders", send(token, {
    placeId, note: null, payHint: "Наличкой мне", closesTime: "12:30", audience: { kind: "picked", employeeIds },
  })));
  return { status: res.status, body: await res.json() };
}

describe("заказы по HTTP", () => {
  it("создание рассылает письма и отдаёт вид с меню", async () => {
    const { app, sent, igor, anyaT, placeId } = await stage();
    const { status, body } = await newOrder(app, anyaT, igor, placeId);
    expect(status).toBe(201);
    expect(body.delivered).toBe(2);
    expect(body.order.menu.map((m: { name: string }) => m.name)).toEqual(["Шаурма"]);
    expect(sent.map((m) => m.to).sort()).toEqual([100, 101]);
  });

  it("несуществующее место — 409", async () => {
    const { app, igor, anyaT } = await stage();
    expect((await newOrder(app, anyaT, igor, 999)).status).toBe(409);
  });

  it("участник добавляет своё блюдо и видит свою сумму; кривая цена — 400", async () => {
    const { app, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    const ok = await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    expect((await ok.json()).order.myTotal).toBe(280);
    const bad = await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: -5 })));
    expect(bad.status).toBe(400);
  });

  it("посторонний — 404 на чтение и на заказ", async () => {
    const { app, igor, anyaT, markT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    expect((await app.request(new Request(`http://x/api/orders/${body.order.id}`, get(markT)))).status).toBe(404);
    expect((await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(markT, { name: "Суп", price: 1 })))).status).toBe(404);
  });

  it("закрытие запускающим рассылает сводку и «сдай»; участнику — 409", async () => {
    const { app, sent, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    const denied = await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(igorT, {})));
    expect(denied.status).toBe(409);
    // Причина отказа — понятная, та же, что в сервисе (`order-service.ts`), не
    // общее «forbidden»: 409-решение ревью, п.5.
    expect((await denied.json()).error).toBe("Закрыть может только тот, кто собирает заказ.");
    const closed = await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    expect(closed.status).toBe(200);
    expect(sent.some((m) => m.to === 101 && m.text.includes("Сдай 280 ₽"))).toBe(true);
    expect(sent.some((m) => m.to === 100 && m.text.includes("Что заказать"))).toBe(true);
  });

  it("второй раз закрыть — 409, сводка запускающему уходит ровно один раз", async () => {
    const { app, sent, igor, anyaT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    const first = await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    expect(first.status).toBe(200);
    expect(sent.filter((m) => m.to === 100 && m.text.includes("Что заказать"))).toHaveLength(1);
    const second = await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    expect(second.status).toBe(409);
    expect(sent.filter((m) => m.to === 100 && m.text.includes("Что заказать"))).toHaveLength(1);
  });

  it("отмена запускающим — «Заказ … отменён» всем адресатам", async () => {
    const { app, sent, igor, anyaT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    const cancelled = await app.request(new Request(`http://x/api/orders/${body.order.id}/cancel`, send(anyaT, {})));
    expect(cancelled.status).toBe(200);
    const notices = sent.filter((m) => m.text.startsWith("🚫 Заказ") && m.text.includes("отменён"));
    expect(notices.map((m) => m.to).sort()).toEqual([100, 101]);
  });

  it("срок в прошлом — 400, ничего не уходит (решение ревью, п.1)", async () => {
    // Системное время подделано на 09:00 UTC = 12:00 команды (MSK): 08:00 уже прошло.
    const { app, sent, igor, anyaT, placeId } = await stage();
    const res = await app.request(new Request("http://x/api/orders", send(anyaT, {
      placeId, note: null, payHint: null, closesTime: "08:00", audience: { kind: "picked", employeeIds: [igor] },
    })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Время уже прошло — поставь позже или оставь пустым.");
    expect(sent).toHaveLength(0);
  });

  it("голое null вместо тела создания — 400, а не падение (решение ревью, п.2)", async () => {
    const { app, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/orders", send(anyaT, null)));
    expect(res.status).toBe(400);
  });

  it("голое null вместо тела правки количества и добавления позиции — 400 (решение ревью, п.2)", async () => {
    const { app, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    const items = await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, null)));
    expect(items.status).toBe(400);
    const added = await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 100 })));
    const itemId = (await added.json()).order.myItems[0].id;
    const qty = await app.request(new Request(`http://x/api/orders/${body.order.id}/items/${itemId}`, send(igorT, null, "PATCH")));
    expect(qty.status).toBe(400);
  });
});

describe("деньги заказа по HTTP", () => {
  it("должник отмечается сам; запускающий видит «1 из 1» поимённо; участник — без списка; аудита на свою отметку нет", async () => {
    const { db, app, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    const mine = await (await app.request(new Request(`http://x/api/orders/${body.order.id}/paid`, send(igorT, { paid: true })))).json();
    expect(mine.order.payment).toEqual({ myPaid: true, paidCount: 1, total: 1, rows: null });
    const boss = await (await app.request(new Request(`http://x/api/orders/${body.order.id}`, get(anyaT)))).json();
    expect(boss.order.payment.rows[0]).toMatchObject({ displayName: "Игорь", paid: true, amount: 280 });
    expect(listRecentAudit(db, 10).find((row) => row.type === "order_payment_marked")).toBeUndefined();
  });

  it("за другого отмечает только управляющий; участнику — 409; у запускающего пишется аудит, а повтор — нет (changed: false)", async () => {
    const { db, app, anya, igor, mark, anyaT, igorT, markT, placeId } = await stage();
    const { body } = await newOrderFor(app, anyaT, [igor, mark], placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));

    // Марк — участник (не Игорь, не запускающий) — пробует отметить Игоря: отказ.
    const denied = await app.request(new Request(`http://x/api/orders/${body.order.id}/payments/${igor}`, send(markT, { paid: true })));
    expect(denied.status).toBe(409);
    expect((await denied.json()).error).toBe("Отметить за другого может только тот, кто собирает заказ.");

    const marked = await app.request(new Request(`http://x/api/orders/${body.order.id}/payments/${igor}`, send(anyaT, { paid: true })));
    expect(marked.status).toBe(200);
    const entries = listRecentAudit(db, 10).filter((row) => row.type === "order_payment_marked");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorEmployeeId).toBe(anya);
    expect(entries[0]?.payload).toMatchObject({ orderId: body.order.id, payerId: igor, payerName: "Игорь", paid: true });

    // Повтор той же отметки — changed: false, второй строки в аудите нет.
    await app.request(new Request(`http://x/api/orders/${body.order.id}/payments/${igor}`, send(anyaT, { paid: true })));
    expect(listRecentAudit(db, 10).filter((row) => row.type === "order_payment_marked")).toHaveLength(1);
  });

  it("не тот id адресата — 400, а не падение", async () => {
    const { app, igor, anyaT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    const res = await app.request(new Request(`http://x/api/orders/${body.order.id}/payments/не-число`, send(anyaT, { paid: true })));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Не тот человек.");
  });

  it("«Напомнить» уходит только не сдавшим, и только от запускающего; пишет аудит", async () => {
    const { db, app, sent, anya, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    expect((await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(igorT, {})))).status).toBe(409);
    const res = await (await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})))).json();
    expect(res).toEqual({ delivered: 1, unpaid: 1, unreachable: [] });
    const reminded = listRecentAudit(db, 10).find((row) => row.type === "order_reminded");
    expect(reminded?.actorEmployeeId).toBe(anya);
    expect(reminded?.payload).toMatchObject({ orderId: body.order.id, delivered: 1, unreachable: 0 });
    await app.request(new Request(`http://x/api/orders/${body.order.id}/paid`, send(igorT, { paid: true })));
    const again = await (await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})))).json();
    expect(again).toEqual({ delivered: 0, unpaid: 0, unreachable: [] });
    expect(sent.filter((m) => m.text.startsWith("⏰"))).toHaveLength(1);
  });

  it("«Напомнить»: недостижимый (бот заблокирован) — в unreachable, delivered считается отдельно от unpaid", async () => {
    const { app, sent, failFor, igor, mark, anyaT, igorT, markT, placeId } = await stage();
    const { body } = await newOrderFor(app, anyaT, [igor, mark], placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(markT, { name: "Чай", price: 50 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    failFor.add(102); // Марк — «бот заблокирован»
    const res = await (await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})))).json();
    expect(res).toEqual({ delivered: 1, unpaid: 2, unreachable: ["Марк"] });
    expect(sent.filter((m) => m.text.startsWith("⏰")).map((m) => m.to)).toEqual([101]);
  });

  it("«Напомнить» на отменённом заказе — «Заказ отменён — напоминать не о чем.», раньше проверки «закрыт ли»", async () => {
    const { app, igor, anyaT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/cancel`, send(anyaT, {})));
    const res = await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Заказ отменён — напоминать не о чем.");
  });

});

/**
 * Рассылка идёт внутри запроса; релей обрывает долгий ответ, человек жмёт ещё
 * раз — и команда получила бы заказ (или дожим) дважды. Тот же приём, что у
 * объявлений (`announcementsInFlight` в app.ts).
 */
describe("заказ и дожим не рассылаются дважды", () => {
  it("второй заказ из того же места, пока первый рассылается, — 409 «Рассылка уже идёт — подожди.»", async () => {
    const { app, sent, hold, igor, anyaT, placeId } = await stage();
    const gate = hold();
    const first = newOrder(app, anyaT, igor, placeId);
    await vi.waitFor(() => expect(gate.waiting()).toBeGreaterThan(0));
    const second = await newOrder(app, anyaT, igor, placeId);
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("Рассылка уже идёт — подожди.");
    gate.release();
    expect((await first).status).toBe(201);
    expect(sent).toHaveLength(2);
  });

  it("то же место (или оба без места) в течение двух минут — 409; другое место — можно; через две минуты — можно", async () => {
    const { db, app, sent, igor, anyaT, placeId } = await stage();
    expect((await newOrder(app, anyaT, igor, placeId)).status).toBe(201);
    const again = await newOrder(app, anyaT, igor, placeId);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("Такой уже разослан пару минут назад — проверь чат.");
    expect(sent).toHaveLength(2);
    expect((await newOrder(app, anyaT, igor, null)).status).toBe(201);
    expect((await newOrder(app, anyaT, igor, null)).status).toBe(409);
    // Окно считается по часам базы (`created_at` пишет SQLite), поэтому
    // «прошло две минуты» — это состаренные строки, а не подделанный Date.
    db.update(foodOrders).set({ createdAt: sql`unixepoch() - 121` }).run();
    expect((await newOrder(app, anyaT, igor, placeId)).status).toBe(201);
  });

  it("отменённый заказ повтору не мешает — его отменили нарочно", async () => {
    const { app, igor, anyaT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/cancel`, send(anyaT, {})));
    expect((await newOrder(app, anyaT, igor, placeId)).status).toBe(201);
  });

  it("второй «Напомнить», пока первый рассылается, — 409 «Рассылка уже идёт — подожди.», дожим уходит одной волной", async () => {
    const { app, sent, hold, igor, anyaT, igorT, placeId } = await stage();
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await app.request(new Request(`http://x/api/orders/${body.order.id}/close`, send(anyaT, {})));
    const gate = hold();
    const first = app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})));
    await vi.waitFor(() => expect(gate.waiting()).toBeGreaterThan(0));
    const second = await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Рассылка уже идёт — подожди.");
    gate.release();
    expect((await first).status).toBe(200);
    expect(sent.filter((m) => m.text.startsWith("⏰"))).toHaveLength(1);
    // Замок снят вместе с концом волны.
    expect((await app.request(new Request(`http://x/api/orders/${body.order.id}/remind`, send(anyaT, {})))).status).toBe(200);
  });
});

/**
 * Письмо заказа в чате печатает «Твой заказ» — после правки в мини-аппе оно
 * врало бы, пока человек не тапнет в чате. Перерисовка — косметика: ответ
 * ручки её не ждёт и от её отказа не ломается.
 */
describe("письмо в чате перерисовывается после правки в мини-аппе", () => {
  type EditCall = [number, number, string, unknown];
  const editsTo = (api: { editMessageText: { mock: { calls: unknown[][] } } }, tg: number) =>
    (api.editMessageText.mock.calls as EditCall[]).filter((call) => call[0] === tg);

  async function staged() {
    const s = await stage();
    const { body } = await newOrder(s.app, s.anyaT, s.igor, s.placeId);
    const igorMessage = s.sent.find((m) => m.to === 101)!.id;
    return { ...s, orderId: body.order.id as number, igorMessage };
  }

  it("добавил своё блюдо — письмо Игоря правится с новой позицией и прежними кнопками", async () => {
    const { app, api, igorT, orderId, igorMessage } = await staged();
    const res = await app.request(new Request(`http://x/api/orders/${orderId}/items`, send(igorT, { name: "Суп дня", price: 280 })));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(editsTo(api, 101)).toHaveLength(1));
    const [, messageId, text, extra] = editsTo(api, 101)[0]!;
    expect(messageId).toBe(igorMessage);
    expect(text).toContain("Твой заказ:");
    expect(text).toContain("Суп дня");
    const buttons = ((extra as { reply_markup: { inline_keyboard: { text: string }[][] } }).reply_markup.inline_keyboard).flat().map((b) => b.text);
    expect(buttons).toContain("🙅 Не буду");
    expect(buttons).not.toContain("🔒 Закрыть приём");
    // Письмо запускающей не трогается: правила Игорь.
    expect(editsTo(api, 100)).toHaveLength(0);
  });

  it("количество, удаление и «Не буду» — тоже перерисовывают", async () => {
    const { app, api, igorT, orderId } = await staged();
    const added = await (await app.request(new Request(`http://x/api/orders/${orderId}/items`, send(igorT, { name: "Суп", price: 280 })))).json();
    const itemId = added.order.myItems[0].id;
    await app.request(new Request(`http://x/api/orders/${orderId}/items/${itemId}`, send(igorT, { qty: 3 }, "PATCH")));
    await vi.waitFor(() => expect(editsTo(api, 101).at(-1)![2]).toContain("Суп ×3"));
    await app.request(new Request(`http://x/api/orders/${orderId}/items/${itemId}`, send(igorT, {}, "DELETE")));
    await vi.waitFor(() => expect(editsTo(api, 101).at(-1)![2]).not.toContain("Суп"));
    await app.request(new Request(`http://x/api/orders/${orderId}/decline`, send(igorT, {})));
    await vi.waitFor(() => expect(editsTo(api, 101).at(-1)![2]).toContain("Ты не заказываешь."));
  });

  it("отказ правки (письмо удалено) — ответ ручки всё равно 200", async () => {
    const { app, api, igorT, orderId } = await staged();
    api.editMessageText.mockRejectedValueOnce(new Error("Bad Request: message to edit not found"));
    const res = await app.request(new Request(`http://x/api/orders/${orderId}/items`, send(igorT, { name: "Суп", price: 280 })));
    expect(res.status).toBe(200);
    await vi.waitFor(() => expect(editsTo(api, 101)).toHaveLength(1));
  });

  it("письмо не дошло (message_id нет) — править нечего, правки нет", async () => {
    const { app, api, failFor, igor, anyaT, igorT, placeId } = await stage();
    failFor.add(101);
    const { body } = await newOrder(app, anyaT, igor, placeId);
    await app.request(new Request(`http://x/api/orders/${body.order.id}/items`, send(igorT, { name: "Суп", price: 280 })));
    await new Promise((r) => setTimeout(r, 20));
    expect(editsTo(api, 101)).toHaveLength(0);
  });
});
