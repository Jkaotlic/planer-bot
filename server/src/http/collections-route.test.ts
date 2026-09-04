import { describe, it, expect, vi } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "./app";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, setBirthDate, setEmployeeAdmin } from "../repo/employees";
import { listRecentAudit } from "../repo/audit";
import { ensureBirthdayRound } from "../birthdays/birthday-service";
import { markCollectionSent, setCollectionClosed, updateCollection } from "../collections/collection-service";
import { signInitData } from "../auth/telegram";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

/** A bot that records what it was asked to send instead of talking to Telegram. */
function fakeBot() {
  const sent: { to: number; text: string; buttons: string[] }[] = [];
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string, extra?: { reply_markup?: unknown }) => {
        // Кнопки — часть письма: под письмом команде висит «Я перевёл», и тест
        // обязан их видеть.
        const markup = extra?.reply_markup as { inline_keyboard?: { text: string }[][] } | undefined;
        sent.push({ to, text, buttons: (markup?.inline_keyboard ?? []).flat().map((b) => b.text) });
      }),
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
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const send = (token: string, body: unknown, method: string) => ({
  method, headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
});

function person(db: Db, name: string, tg: number | null, birthDate: string | null): number {
  const employee = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  if (tg != null) linkTelegramAccount(db, `inv-${name}`, tg);
  if (birthDate) setBirthDate(db, employee.id, birthDate);
  return employee.id;
}

const ASOF = "asOf=2026-08-10";

describe("POST /api/admin/collections", () => {
  it("creates a collection with nothing but a subject", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const res = await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Кофемашина" }, "POST"));
    expect(res.status).toBe(200);
    const { collection } = await res.json();
    expect(collection).toMatchObject({ kind: "custom", title: "Кофемашина", employeeId: null, sendCount: 0 });
    expect(listRecentAudit(db, 5)[0]!.type).toBe("collection_created");
  });

  it("refuses an empty subject", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const res = await app.request(`/api/admin/collections?${ASOF}`,
      send(await tokenFor(app, 111), { title: "   " }, "POST"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/admin/collections/:id/send", () => {
  it("sends to everybody but the honouree and can send again", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const honouree = person(db, "Honouree", 5, null);
    person(db, "Colleague", 6, null);
    const token = await tokenFor(app, 111);

    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Свадьба", employeeId: honouree, collectUrl: "https://example.test/c/1" }, "POST"))).json();

    const first = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`,
      send(token, { confirm: true }, "POST"));
    expect(first.status).toBe(200);
    expect(sent.map((m) => m.to)).not.toContain(5);
    expect(sent.length).toBeGreaterThan(0);
    // Отметиться — там же, где прочитал: под каждым письмом команде «Я перевёл».
    for (const m of sent) expect(m.buttons).toContain("✅ Я перевёл");

    const again = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`,
      send(token, { confirm: true }, "POST"));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ round: 2 });
    // The second round is worded as a reminder.
    expect(sent.at(-1)!.text).toContain("Напоминаю про сбор");
    expect(sent.at(-1)!.buttons).toContain("✅ Я перевёл");
  });

  it("needs an explicit confirmation", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    person(db, "Colleague", 6, null);
    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Кофемашина", collectUrl: "https://example.test/c/1" }, "POST"))).json();
    const res = await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`, send(token, {}, "POST"));
    expect(res.status).toBe(400);
  });
});

describe("PUT /api/admin/collections/:id", () => {
  it("сбор на день рождения вооружается и будит остальных админов и отсюда тоже", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const mark = person(db, "Марк", 1, "09-07");
    setEmployeeAdmin(db, person(db, "Игорь", 2, null), true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    // Раунд заводится вооружённым: без выключения тест прошёл бы и без единой
    // строки вооружения в этой ручке.
    updateCollection(db, round.id, { autoSendOn: null });

    const res = await app.request(`/api/admin/collections/${round.id}?asOf=2026-09-01`,
      send(token, { collectUrl: "https://example.com/sbor" }, "PUT"));

    expect(res.status).toBe(200);
    // Ровно то же, что делает ручка дней рождения: одно правило на два входа.
    expect((await res.json()).collection.autoSendOn).toBe("2026-09-04");
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).toContain("Марк");
  });

  it("разосланный сбор на ДР и отсюда не вооружается", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const mark = person(db, "Марк", 1, "09-07");
    setEmployeeAdmin(db, person(db, "Игорь", 2, null), true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { autoSendOn: null });
    markCollectionSent(db, round.id, 3, new Date("2026-09-01T07:00:00Z"));

    const res = await app.request(`/api/admin/collections/${round.id}?asOf=2026-09-01`,
      send(token, { collectUrl: "https://example.com/svezhaya" }, "PUT"));

    // Тот же ответ, что у ручки дней рождения: правило одно на два входа.
    expect((await res.json()).collection.autoSendOn).toBeNull();
    expect(sent.map((m) => m.to)).toEqual([2]);
    expect(sent[0]!.text).not.toContain("разошлёт");
  });

  it("закрытый сбор на ДР и отсюда не вооружается и никого не будит", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    const mark = person(db, "Марк", 1, "09-07");
    setEmployeeAdmin(db, person(db, "Игорь", 2, null), true);
    const round = ensureBirthdayRound(db, mark, "2026-09-01")!;
    updateCollection(db, round.id, { autoSendOn: null });
    setCollectionClosed(db, round.id, true, new Date("2026-09-01T07:00:00Z"));

    const res = await app.request(`/api/admin/collections/${round.id}?asOf=2026-09-01`,
      send(token, { collectUrl: "https://example.com/svezhaya" }, "PUT"));

    // Тот же ответ, что у ручки дней рождения: правило одно на все входы.
    expect((await res.json()).collection.autoSendOn).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("кастомный сбор ссылка не вооружает и никого не будит", async () => {
    const db = makeTestDb();
    const { bot, sent } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    setEmployeeAdmin(db, person(db, "Игорь", 2, null), true);
    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Кофемашина" }, "POST"))).json();

    const res = await app.request(`/api/admin/collections/${collection.id}?${ASOF}`,
      send(token, { collectUrl: "https://example.com/sbor" }, "PUT"));

    expect(res.status).toBe(200);
    // У кастомного сбора нет даты, от которой считать «за три дня», и он сам не
    // уйдёт. Письмо «делать ничего не надо» про него было бы неправдой.
    expect((await res.json()).collection.autoSendOn).toBeNull();
    expect(sent).toHaveLength(0);
  });
});

describe("POST /api/admin/collections/:id/close", () => {
  it("closes and re-opens", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const token = await tokenFor(app, 111);
    const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Кофемашина" }, "POST"))).json();

    await app.request(`/api/admin/collections/${collection.id}/close?${ASOF}`, send(token, { closed: true }, "POST"));
    const closed = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    expect(closed.collections[0].active).toBe(false);

    await app.request(`/api/admin/collections/${collection.id}/close?${ASOF}`, send(token, { closed: false }, "POST"));
    const open = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    expect(open.collections[0].active).toBe(true);
  });
});

describe("the surprise rule on every collection route", () => {
  it("hides a collection from its own honouree, list and single alike", async () => {
    const db = makeTestDb();
    const app = createApp({ db, config });
    const selfAdmin = person(db, "SelfAdmin", 111, null);
    setEmployeeAdmin(db, selfAdmin, true);
    const other = person(db, "Other", 7, null);
    const token = await tokenFor(app, 111);

    const mine = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Про меня", employeeId: selfAdmin }, "POST"))).json();
    await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Про другого", employeeId: other }, "POST"));

    const list = await (await app.request(`/api/admin/collections?${ASOF}`, auth(token))).json();
    // The other collection must survive — an empty list would pass on a broken filter.
    expect(list.collections.map((row: { title: string }) => row.title)).toEqual(["Про другого"]);

    for (const [path, method, body] of [
      [`/api/admin/collections/${mine.collection.id}/preview`, "GET", undefined],
      [`/api/admin/collections/${mine.collection.id}`, "PUT", { collectUrl: "https://example.test/c/1" }],
      [`/api/admin/collections/${mine.collection.id}/send`, "POST", { confirm: true }],
      [`/api/admin/collections/${mine.collection.id}/close`, "POST", { closed: true }],
      [`/api/admin/collections/${mine.collection.id}`, "DELETE", undefined],
    ] as const) {
      const res = await app.request(`http://x${path}?${ASOF}`,
        body === undefined ? { method, ...auth(token) } : send(token, body, method));
      expect([res.status, path, method]).toEqual([404, path, method]);
    }
  });
});

describe("DELETE /api/admin/collections/:id", () => {
  it("removes an unsent collection and refuses a sent one", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const token = await tokenFor(app, 111);
    person(db, "Colleague", 6, null);

    const fresh = await (await app.request(`/api/admin/collections?${ASOF}`, send(token, { title: "Ошибка" }, "POST"))).json();
    expect((await app.request(`/api/admin/collections/${fresh.collection.id}?${ASOF}`,
      { method: "DELETE", ...auth(token) })).status).toBe(200);

    const gone = await (await app.request(`/api/admin/collections?${ASOF}`,
      send(token, { title: "Ушедший", collectUrl: "https://example.test/c/1" }, "POST"))).json();
    await app.request(`/api/admin/collections/${gone.collection.id}/send?${ASOF}`, send(token, { confirm: true }, "POST"));
    expect((await app.request(`/api/admin/collections/${gone.collection.id}?${ASOF}`,
      { method: "DELETE", ...auth(token) })).status).toBe(409);
  });
});

describe("GET /api/collections", () => {
  it("is open to a plain worker and hides their own collection", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const worker = person(db, "Worker", 222, null);
    person(db, "Colleague", 6, null);
    const adminToken = await tokenFor(app, 111);

    for (const [title, employeeId] of [["Про работника", worker], ["Общий", null]] as const) {
      const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
        send(adminToken, { title, employeeId, collectUrl: "https://example.test/c/1" }, "POST"))).json();
      await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`, send(adminToken, { confirm: true }, "POST"));
    }

    const res = await app.request(`/api/collections?${ASOF}`, auth(await tokenFor(app, 222)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.collections.map((c: { title: string }) => c.title)).toEqual(["Общий"]);
  });
});

describe("the journal and the surprise rule", () => {
  it("hides a collection's own events from its honouree, and shows everyone else's", async () => {
    const db = makeTestDb();
    const { bot } = fakeBot();
    const app = createApp({ db, config, bot });
    const selfAdmin = person(db, "SelfAdmin", 111, null);
    setEmployeeAdmin(db, selfAdmin, true);
    const otherAdmin = person(db, "OtherAdmin", 7, null);
    setEmployeeAdmin(db, otherAdmin, true);
    person(db, "Colleague", 8, null);

    // Prepared by the other admin, so the surprise is real: one collection for
    // the self-admin, one for nobody in particular.
    const otherToken = await tokenFor(app, 7);
    for (const employeeId of [selfAdmin, null]) {
      const { collection } = await (await app.request(`/api/admin/collections?${ASOF}`,
        send(otherToken, { title: employeeId ? "Про меня" : "Общий", employeeId, collectUrl: "https://example.test/c/1" }, "POST"))).json();
      await app.request(`/api/admin/collections/${collection.id}/send?${ASOF}`,
        send(otherToken, { confirm: true }, "POST"));
    }

    const forSelf = await (await app.request(`/api/admin/journal?${ASOF}`, auth(await tokenFor(app, 111)))).json();
    const titles = forSelf.events
      .filter((e: { type: string }) => e.type.startsWith("collection_"))
      .map((e: { payload: { title?: string } }) => e.payload.title);

    // The general collection's rows survive — an empty answer would pass against
    // a filter that hides everything, and against a payload with no employeeId
    // at all (json_extract would then return null for every row).
    expect(titles).toContain("Общий");
    expect(titles).not.toContain("Про меня");

    // The other admin, who is nobody's honouree here, sees both.
    const forOther = await (await app.request(`/api/admin/journal?${ASOF}`, auth(otherToken))).json();
    const otherTitles = forOther.events
      .filter((e: { type: string }) => e.type.startsWith("collection_"))
      .map((e: { payload: { title?: string } }) => e.payload.title);
    expect(otherTitles).toContain("Общий");
    expect(otherTitles).toContain("Про меня");
  });
});
