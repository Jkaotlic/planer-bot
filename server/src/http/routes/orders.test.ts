import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";
import { createPlace } from "../../orders/place-service";

function fakeBot() {
  const sent: { to: number; text: string }[] = [];
  let nextId = 1;
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => { sent.push({ to, text }); return { message_id: nextId++ }; }),
      editMessageReplyMarkup: vi.fn(async () => ({})),
    },
  };
  return { bot: bot as unknown as Bot, sent };
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
  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  const mark = person(db, "Марк", 102);
  const place = createPlace(db, { name: "Шаурмечная", menu: [{ name: "Шаурма", price: 350 }] }, anya);
  return {
    db, app, sent, anya, igor, mark, placeId: place.id,
    anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102),
  };
}

async function newOrder(app: App, token: string, igor: number, placeId: number | null) {
  const res = await app.request(new Request("http://x/api/orders", send(token, {
    placeId, note: null, payHint: "Наличкой мне", closesTime: "12:30", audience: { kind: "picked", employeeIds: [igor] },
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
