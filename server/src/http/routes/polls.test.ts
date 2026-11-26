import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GrammyError, type Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { archiveEmployee, createEmployee, linkTelegramAccount } from "../../repo/employees";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import { openDb, runMigrations, type Db } from "../../db/client";
import { eq, sql } from "drizzle-orm";
import { employees, polls } from "../../db/schema";
import { listRecentAudit } from "../../repo/audit";
import { runFoodTick } from "../../food/food-tick";
import { retryTelegramPollInvites } from "../../polls/poll-messenger";
import { recordTelegramPollAnswer, recordTelegramPollState } from "../../polls/poll-service";

function fakeBot() {
  const sent: { to: number; text: string; id: number }[] = [];
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
      sendPoll: vi.fn(async (to: number) => {
        if (gate) { waiting += 1; await gate; }
        if (failFor.has(to)) throw new Error("Forbidden: bot was blocked by the user");
        const id = nextId++;
        return { message_id: id, chat: { id: to, type: "private" }, poll: { id: `native-${id}` } };
      }),
      stopPoll: vi.fn(async () => ({})),
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

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T09:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

async function stage(db = makeTestDb()) {
  const { bot, sent, failFor, hold, api } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  person(db, "Марк", 102);
  return { db, app, bot, sent, failFor, hold, api, anya, igor, anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102) };
}

describe("опросы по HTTP", () => {
  it("рассылает защищённые личные опросы Telegram с общим сроком и прекращает голосование при закрытии", async () => {
    const { app, api, igor, anyaT, igorT } = await stage();
    const res = await app.request(new Request("http://x/api/polls", send(anyaT, {
      question: "Какой день?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Пятница", "Суббота"], multiple: true },
    })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.delivered).toBe(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    expect(api.sendPoll.mock.calls).toEqual([100, 101].map(to => [
      to, "Какой день?", [{ text: "Пятница" }, { text: "Суббота" }], expect.objectContaining({
        type: "regular", is_anonymous: false, allows_multiple_answers: true, protect_content: true,
        allows_revoting: true, close_date: Date.parse("2026-09-29T15:00:00Z") / 1000,
      }),
    ]));

    const vote = await app.request(new Request(`http://x/api/polls/${body.poll.id}/vote`, send(igorT, { choice: "for" })));
    expect(vote.status).toBe(409);
    const reminder = await app.request(new Request(`http://x/api/polls/${body.poll.id}/remind`, send(anyaT, {})));
    expect(reminder.status).toBe(200);
    expect(api.sendPoll).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenCalledWith(101, expect.stringContaining("опрос"), expect.objectContaining({
      reply_parameters: { message_id: 2 }, protect_content: true,
    }));

    const close = await app.request(new Request(`http://x/api/polls/${body.poll.id}/close`, send(anyaT, {})));
    expect(close.status).toBe(200);
    expect(api.stopPoll.mock.calls).toEqual([[100, 1], [101, 2]].map(([chat, message]) => [
      chat, message, { reply_markup: { inline_keyboard: [] } },
    ]));
    expect(api.sendMessage).toHaveBeenCalledWith(101, expect.stringContaining("Пятница"), { protect_content: true });
  });

  it("разрешает вопрос из 300 символов только в опросе Telegram", async () => {
    const { app, api, igor, anyaT } = await stage();
    const question = "Я".repeat(300);
    const body = { question, closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] } };
    expect((await app.request("/api/polls", send(anyaT, body))).status).toBe(400);
    expect((await app.request("/api/polls", send(anyaT, {
      ...body, telegram: { options: ["Один", "Два"], multiple: false },
    }))).status).toBe(201);
    expect(api.sendPoll).toHaveBeenCalledTimes(2);
  });

  it("не открывает карточки на больший срок, если до закрытия осталось меньше минимального интервала", async () => {
    vi.setSystemTime(new Date("2026-09-29T14:59:54Z"));
    const { app, api, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ delivered: 0, deliveredToNobody: true });
    expect(api.sendPoll).not.toHaveBeenCalled();
  });

  it.each([true, false])("ждёт состояние закрытой по сроку карточки один тик (пришло: %s)", async (snapshotArrived) => {
    const { db, app, api, bot, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "12:01", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    expect(response.status).toBe(201);
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 0,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 0 }],
    }).mockRejectedValueOnce(new GrammyError("Stop failed", {
      ok: false, error_code: 400, description: "Bad Request: poll has already been closed",
    }, "stopPoll", { chat_id: 101, message_id: 2 }));

    vi.setSystemTime(new Date("2026-09-29T09:01:00Z"));
    expect(await runFoodTick(db, bot, { date: "2026-09-29", time: "12:01" })).toBe(1);
    expect(api.sendMessage).not.toHaveBeenCalled();
    if (snapshotArrived) {
      expect(recordTelegramPollState(db, {
        id: "native-2", is_closed: true, total_voter_count: 1,
        options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
      })).toBe(true);
    }

    vi.setSystemTime(new Date("2026-09-29T09:06:00Z"));
    expect(await runFoodTick(db, bot, { date: "2026-09-29", time: "12:06" })).toBe(0);
    expect(api.stopPoll).toHaveBeenCalledTimes(2);
    expect(api.sendMessage.mock.calls.map(([chat]) => chat)).toEqual([100, 101]);
    const body = api.sendMessage.mock.calls[0]?.[1];
    expect(body).toContain(`Один — 0\n• Два — ${snapshotArrived ? 1 : 0}`);
    expect(body?.includes("Предварительный")).toBe(!snapshotArrived);
  });

  it("после рестарта повторяет подтверждённый 429, сохраняя неопределённую доставку без дубля", async () => {
    const dir = mkdtempSync(join(tmpdir(), "planer-poll-invites-"));
    const path = join(dir, "polls.db");
    let connection = openDb(path);
    try {
      runMigrations(connection.db, connection.sqlite);
      const { app, api, anyaT, markT } = await stage(connection.db);
      person(connection.db, "Дима", 103);
      const sendPoll = api.sendPoll.getMockImplementation()!;
      api.sendPoll.mockImplementation(async (chatId) => {
        if (chatId === 101) throw new GrammyError("Rate limited", {
          ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 420 },
        }, "sendPoll", { chat_id: chatId });
        if (chatId === 102) throw new Error("ECONNRESET");
        if (chatId === 103) throw new GrammyError("Blocked", {
          ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user",
        }, "sendPoll", { chat_id: chatId });
        return sendPoll(chatId);
      });
      const body = { question: "Дежурство?", closesTime: "18:00", audience: { kind: "team" },
        telegram: { options: ["Один", "Два"], multiple: false } };
      const response = await app.request("/api/polls", send(anyaT, body));
      const created = await response.json();
      expect(created).toMatchObject({
        delivered: 0, unreachable: expect.arrayContaining(["Дима", "Игорь", "Марк"]),
        poll: { telegram: { delivery: { pending: ["Игорь"], unknown: ["Марк"], failed: ["Дима"] } } },
      });
      expect(created.unreachable).toHaveLength(3);
      const recipient = await (await app.request(`/api/polls/${created.poll.id}`, get(markT))).json();
      expect(recipient.poll.telegram).not.toHaveProperty("delivery");
      connection.sqlite.close();

      connection = openDb(path);
      const resumed = fakeBot();
      resumed.api.sendPoll.mockImplementation(async (chatId) => ({
        message_id: 90, chat: { id: chatId, type: "private" }, poll: { id: "native-90" },
      }));
      vi.setSystemTime(new Date("2026-09-29T09:05:00Z"));
      await retryTelegramPollInvites(resumed.bot, connection.db, config.teamTz);
      expect(resumed.api.sendPoll).not.toHaveBeenCalled();
      vi.setSystemTime(new Date("2026-09-29T09:10:00Z"));
      await retryTelegramPollInvites(resumed.bot, connection.db, config.teamTz);
      expect(resumed.api.sendPoll.mock.calls.map(([chatId]) => chatId)).toEqual([101]);
      expect(recordTelegramPollAnswer(connection.db, "native-90", 101, [0], {
        date: "2026-09-29", time: "12:10",
      })).toBe(true);
      vi.setSystemTime(new Date("2026-09-29T09:15:00Z"));
      await retryTelegramPollInvites(resumed.bot, connection.db, config.teamTz);
      expect(resumed.api.sendPoll.mock.calls.map(([chatId]) => chatId)).toEqual([101]);
      const reloaded = createApp({ db: connection.db, config, bot: resumed.bot });
      const current = await (await reloaded.request(`/api/polls/${created.poll.id}`, get(anyaT))).json();
      expect(current.poll.telegram.delivery).toEqual({ pending: [], unknown: ["Марк"], failed: ["Дима"] });
    } finally {
      if (connection.sqlite.open) connection.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(["12:01", null])("после дедлайна (%s) кнопка успевает сверить снимки до планового тика", async (closesTime) => {
    const { db, app, api, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime, audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    const { poll } = await response.json();
    if (closesTime == null) db.update(polls).set({ createdAt: new Date("2026-09-26T09:01:00Z") }).where(eq(polls.id, poll.id)).run();
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 0,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 0 }],
    }).mockResolvedValueOnce({
      id: "native-2", is_closed: true, total_voter_count: 1,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
    });
    vi.setSystemTime(new Date("2026-09-29T09:01:30Z"));
    const done = await app.request(`/api/polls/${poll.id}/close`, send(anyaT, {}));
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ poll: { open: false, telegram: { votedCount: 1 } } });
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain("Один — 0\n• Два — 1");
  });

  it("при ручном закрытии сохраняет известный выбор, даже если после отказа stopPoll пришёл поздний голос", async () => {
    const { db, app, api, bot, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    const { poll } = await response.json();
    const now = { date: "2026-09-29", time: "12:00" };
    expect(recordTelegramPollAnswer(db, "native-2", 101, [0], now)).toBe(true);
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 0,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 0 }],
    }).mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await app.request(`/api/polls/${poll.id}/close`, send(anyaT, {}))).status).toBe(200);
    expect(recordTelegramPollAnswer(db, "native-2", 101, [1], now)).toBe(false);
    api.stopPoll.mockResolvedValueOnce({
      id: "native-2", is_closed: true, total_voter_count: 1,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
    });
    vi.setSystemTime(new Date("2026-09-29T09:05:01Z"));
    await runFoodTick(db, bot, { ...now, time: "12:05" });
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain("Один — 1\n• Два — 0");
    const { poll: current } = await (await app.request(`/api/polls/${poll.id}`, get(anyaT))).json();
    expect(current.telegram.options[0].count).toBe(1);
  });

  it("рассылает единую версию итога, если снимок пришёл между двумя отправками", async () => {
    const { db, app, api, bot, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "12:01", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    const { poll } = await response.json();
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 0,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 0 }],
    }).mockRejectedValueOnce(new GrammyError("Stop failed", {
      ok: false, error_code: 400, description: "Bad Request: poll has already been closed",
    }, "stopPoll", { chat_id: 101, message_id: 2 }));
    vi.setSystemTime(new Date("2026-09-29T09:01:00Z"));
    await runFoodTick(db, bot, { date: "2026-09-29", time: "12:01" });
    api.sendMessage.mockImplementationOnce(async () => {
      expect(recordTelegramPollState(db, {
        id: "native-2", is_closed: true, total_voter_count: 1,
        options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
      })).toBe(true);
      throw new Error("ECONNRESET");
    });
    vi.setSystemTime(new Date("2026-09-29T09:06:00Z"));
    await runFoodTick(db, bot, { date: "2026-09-29", time: "12:06" });
    const [first, second] = api.sendMessage.mock.calls.map(([, text]) => text);
    expect(first).toContain("Предварительный итог");
    expect(first).toContain("Ответили: 0");
    expect(second).toBe(first);
    const { poll: current } = await (await app.request(`/api/polls/${poll.id}`, get(anyaT))).json();
    expect(current.telegram.votedCount).toBe(1);
    vi.setSystemTime(new Date("2026-09-29T09:11:00Z"));
    await runFoodTick(db, bot, { date: "2026-09-29", time: "12:11" });
    expect(api.sendMessage.mock.calls.map(([chatId]) => chatId)).toEqual([100, 101, 100]);
    expect(api.sendMessage.mock.calls[2]?.[1]).toBe(first);
  });

  it("показывает имя коллеги, которому Telegram не доставил опрос", async () => {
    const { app, failFor, anyaT } = await stage();
    failFor.add(101);
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: null, audience: { kind: "team" },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ delivered: 1, unreachable: ["Игорь"], deliveredToNobody: false });
  });

  it("пробует остановить и карточку ушедшего работника, а после сбоя повторяет только отказ", async () => {
    const { db, app, api, bot, igor, anyaT } = await stage();
    const response = await app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    expect(response.status).toBe(201);
    const { poll } = await response.json();
    archiveEmployee(db, igor, "2026-09-29");
    expect(recordTelegramPollAnswer(db, "native-1", 100, [1], { date: "2026-09-29", time: "12:00" })).toBe(true);
    api.stopPoll.mockRejectedValueOnce(new Error("ECONNRESET"));
    expect((await app.request(`/api/polls/${poll.id}/close`, send(anyaT, {}))).status).toBe(200);
    expect(api.stopPoll.mock.calls).toHaveLength(2);
    expect(api.sendMessage).not.toHaveBeenCalled();
    vi.setSystemTime(new Date("2026-09-29T09:05:01Z"));
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 1,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
    });
    await runFoodTick(db, bot, { date: "2026-09-29", time: "12:05" });
    expect(api.stopPoll.mock.calls.map(call => call.slice(0, 2))).toEqual([[100, 1], [101, 2], [100, 1]]);
    expect(api.sendMessage.mock.calls.map(([chat]) => chat)).toEqual([100]);
    expect(api.sendMessage.mock.calls[0]?.[1]).toContain("Один — 0\n• Два — 1");
  });

  it("закрывает опоздавшую карточку и прекращает веер, когда закрыли во время первой отправки", async () => {
    const { db, app, api, hold, igor, anyaT } = await stage();
    const gate = hold();
    const launched = app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    await vi.waitFor(() => expect(gate.waiting()).toBe(1));
    const poll = db.select().from(polls).get()!;
    try {
      expect((await app.request(`/api/polls/${poll.id}/close`, send(anyaT, {}))).status).toBe(200);
    } finally {
      gate.release();
    }
    const response = await launched;
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ poll: { open: false }, delivered: 0 });
    expect(api.sendPoll).toHaveBeenCalledTimes(1);
    expect(api.stopPoll.mock.calls.map(call => call.slice(0, 2))).toEqual([[100, 1]]);
    expect(api.sendMessage.mock.calls.map(([chat]) => chat)).toEqual([100]);
  });

  it("после закрытия во время второй отправки ждёт её ответ и рассылает один итог обоим", async () => {
    const { db, app, api, igor, anyaT } = await stage();
    let release!: () => void;
    const secondDelivery = new Promise<void>(resolve => { release = resolve; });
    const originalSend = api.sendPoll.getMockImplementation()!;
    api.sendPoll.mockImplementationOnce(originalSend).mockImplementationOnce(async (chat) => {
      await secondDelivery;
      return originalSend(chat);
    });
    api.stopPoll.mockResolvedValueOnce({
      id: "native-1", is_closed: true, total_voter_count: 0,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 0 }],
    }).mockResolvedValueOnce({
      id: "native-2", is_closed: true, total_voter_count: 1,
      options: [{ text: "Один", voter_count: 0 }, { text: "Два", voter_count: 1 }],
    });

    const launched = app.request("/api/polls", send(anyaT, {
      question: "Дежурство?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] },
      telegram: { options: ["Один", "Два"], multiple: false },
    }));
    try {
      await vi.waitFor(() => expect(api.sendPoll).toHaveBeenCalledTimes(2));
      const poll = db.select().from(polls).get()!;
      expect((await app.request(`/api/polls/${poll.id}/close`, send(anyaT, {}))).status).toBe(200);
      expect(api.stopPoll.mock.calls.map(call => call.slice(0, 2))).toEqual([[100, 1]]);
      expect(api.sendMessage).not.toHaveBeenCalled();
    } finally {
      release();
    }

    const response = await launched;
    expect(await response.json()).toMatchObject({ poll: { open: false }, delivered: 1 });
    expect(api.stopPoll.mock.calls.map(call => call.slice(0, 2))).toEqual([[100, 1], [101, 2]]);
    expect(api.sendMessage.mock.calls.map(([chat]) => chat)).toEqual([100, 101]);
    const [first, second] = api.sendMessage.mock.calls.map(([, text]) => text);
    expect(first).toContain("Один — 0\n• Два — 0");
    expect(second).toBe(first);
  });

  it("работник создаёт опрос вручную выбранным — письма уходят ему и адресату", async () => {
    const { app, sent, igor, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] } })));
    expect(res.status).toBe(201);
    const body = await res.json();
    // Писем два, «Отправлено коллегам» — одно: своё письмо создателя не в счёт.
    expect(body.delivered).toBe(1);
    expect(body.poll.closes).toBe("до 18:00");
    expect(sent.map((m) => m.to).sort()).toEqual([100, 101]);
  });

  it("опрос не дошёл ни до кого из коллег — 201, опрос жив, в ответе deliveredToNobody", async () => {
    // Как у сбора: своё письмо создатель получает почти всегда, но голосов оно не
    // соберёт — без флага форма сказала бы «Опрос отправлен» и «Отправлено коллегам: 0».
    const { db, app, failFor, igor, anyaT } = await stage();
    failFor.add(101);
    const res = await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.delivered).toBe(0);
    expect(body.deliveredToNobody).toBe(true);
    expect(db.select().from(polls).all().map((p) => p.id)).toEqual([body.poll.id]);
  });

  it("дошло коллеге, а создателю нет — deliveredToNobody = false", async () => {
    const { app, failFor, igor, anyaT } = await stage();
    failFor.add(100);
    const body = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    expect(body.delivered).toBe(1);
    expect(body.deliveredToNobody).toBe(false);
  });

  it("пустой вопрос и вопрос длиннее 200 — 400", async () => {
    const { app, anyaT } = await stage();
    for (const question of ["  ", "я".repeat(201)]) {
      const res = await app.request(new Request("http://x/api/polls", send(anyaT, { question, closesTime: null, audience: { kind: "team" } })));
      expect(res.status).toBe(400);
    }
  });

  it("голос адресата принимается, посторонний получает 404", async () => {
    const { app, igor, anyaT, igorT, markT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const ok = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(igorT, { choice: "for" })));
    expect(ok.status).toBe(200);
    expect((await ok.json()).poll.tally.for).toEqual(["Игорь"]);
    const stranger = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(markT, { choice: "for" })));
    expect(stranger.status).toBe(404);
  });

  it("закрыть чужой опрос — 409 с понятной причиной; свой — итог уходит всем", async () => {
    const { app, sent, igor, anyaT, igorT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const denied = await app.request(new Request(`http://x/api/polls/${poll.id}/close`, send(igorT, {})));
    expect(denied.status).toBe(409);
    const closed = await app.request(new Request(`http://x/api/polls/${poll.id}/close`, send(anyaT, {})));
    expect(closed.status).toBe(200);
    expect(sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
  });

  it("список кандидатов не содержит смотрящего", async () => {
    const { app, anyaT } = await stage();
    const { candidates } = await (await app.request(new Request("http://x/api/team-audience", get(anyaT)))).json();
    expect(candidates.map((c: { displayName: string }) => c.displayName)).toEqual(["Игорь", "Марк"]);
  });

  it("08:00 в полдень — срок завтра в 08:00: опрос создан открытым, письма уходят", async () => {
    // Системное время подделано на 09:00 UTC = 12:00 команды (MSK): сегодняшние 08:00 уже прошли.
    const { db, app, sent, igor, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: "08:00", audience: { kind: "picked", employeeIds: [igor] } })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.poll.closes).toBe("до завтра, 08:00");
    expect(body.poll.open).toBe(true);
    expect(db.select().from(polls).all()[0]?.closesAt).toBe("2026-09-30T08:00");
    expect(sent).toHaveLength(2);
  });

  it("битый closesTime — 400", async () => {
    const { app, igor, anyaT } = await stage();
    for (const closesTime of ["25:00", "9:00"]) {
      const res = await app.request(new Request("http://x/api/polls",
        send(anyaT, { question: "Пицца?", closesTime, audience: { kind: "picked", employeeIds: [igor] } })));
      expect(res.status).toBe(400);
    }
  });

  it("второй раз закрыть — 409, «Итоги опроса» уходят ровно один раз", async () => {
    const { app, sent, igor, anyaT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const first = await app.request(new Request(`http://x/api/polls/${poll.id}/close`, send(anyaT, {})));
    expect(first.status).toBe(200);
    expect(sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
    const second = await app.request(new Request(`http://x/api/polls/${poll.id}/close`, send(anyaT, {})));
    expect(second.status).toBe(409);
    expect(sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
  });

  it("закрыть чужой опрос — причина именно «Закрыть может только тот, кто запустил опрос.»", async () => {
    const { app, igor, anyaT, igorT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const denied = await app.request(new Request(`http://x/api/polls/${poll.id}/close`, send(igorT, {})));
    expect(denied.status).toBe(409);
    expect((await denied.json()).error).toBe("Закрыть может только тот, кто запустил опрос.");
  });

  it("отменить свой опрос — 200, адресатам уходит «Опрос отменён»", async () => {
    const { app, sent, igor, anyaT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const cancelled = await app.request(new Request(`http://x/api/polls/${poll.id}/cancel`, send(anyaT, {})));
    expect(cancelled.status).toBe(200);
    const notices = sent.filter((m) => m.text.includes("Опрос отменён"));
    expect(notices.map((m) => m.to).sort()).toEqual([100, 101]);
  });

  it("посторонний не видит чужой опрос и по прямому GET — 404", async () => {
    const { app, igor, anyaT, markT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const res = await app.request(new Request(`http://x/api/polls/${poll.id}`, get(markT)));
    expect(res.status).toBe(404);
    // Мини-апп показывает текст ошибки как есть — «not_found» человеку не нужен.
    expect((await res.json()).error).toBe("Опрос не найден.");
    const vote = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(markT, { choice: "for" })));
    expect((await vote.json()).error).toBe("Опрос не найден.");
  });

  it("голое null вместо тела голоса — 400, а не падение", async () => {
    const { app, igor, anyaT, igorT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const res = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(igorT, null)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Не понял голос.");
  });
});

/**
 * Рассылка идёт внутри запроса; релей обрывает долгий ответ, человек жмёт ещё
 * раз — и команда получила бы опрос дважды (так уже было с объявлениями, см.
 * `announcementsInFlight` в app.ts).
 */
describe("опрос не рассылается дважды", () => {
  const body = (igor: number, question = "Пицца?") => ({ question, closesTime: null, audience: { kind: "picked", employeeIds: [igor] } });

  it("второй такой же запрос, пока первый рассылается, — 409 «Рассылка уже идёт — подожди.»", async () => {
    const { app, sent, hold, igor, anyaT } = await stage();
    const gate = hold();
    const first = app.request(new Request("http://x/api/polls", send(anyaT, body(igor))));
    await vi.waitFor(() => expect(gate.waiting()).toBeGreaterThan(0));
    // Тот же вопрос с другим регистром и пробелами — тот же опрос.
    const second = await app.request(new Request("http://x/api/polls", send(anyaT, body(igor, "  пицца? "))));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Рассылка уже идёт — подожди.");
    gate.release();
    expect((await first).status).toBe(201);
    expect(sent).toHaveLength(2);
  });

  it("тот же вопрос в течение двух минут — 409 «Такой уже разослан…»; другой вопрос — можно; через две минуты — можно", async () => {
    const { db, app, sent, igor, anyaT } = await stage();
    expect((await app.request(new Request("http://x/api/polls", send(anyaT, body(igor))))).status).toBe(201);
    const again = await app.request(new Request("http://x/api/polls", send(anyaT, body(igor, "ПИЦЦА?"))));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("Такой уже разослан пару минут назад — проверь чат.");
    expect(sent).toHaveLength(2);
    expect((await app.request(new Request("http://x/api/polls", send(anyaT, body(igor, "Суши?"))))).status).toBe(201);
    // Окно считается по часам базы (`created_at` пишет SQLite), поэтому
    // «прошло две минуты» — это состаренная строка, а не подделанный Date.
    db.update(polls).set({ createdAt: sql`unixepoch() - 121` }).run();
    expect((await app.request(new Request("http://x/api/polls", send(anyaT, body(igor))))).status).toBe(201);
  });

  it("отменённый опрос повтору не мешает — его отменили нарочно", async () => {
    const { app, igor, anyaT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls", send(anyaT, body(igor))))).json();
    await app.request(new Request(`http://x/api/polls/${poll.id}/cancel`, send(anyaT, {})));
    expect((await app.request(new Request("http://x/api/polls", send(anyaT, body(igor))))).status).toBe(201);
  });

  it("тот же вопрос от другого человека — можно", async () => {
    const { app, anya, igor, anyaT, igorT } = await stage();
    expect((await app.request(new Request("http://x/api/polls", send(anyaT, body(igor))))).status).toBe(201);
    expect((await app.request(new Request("http://x/api/polls", send(igorT, body(anya))))).status).toBe(201);
  });
});

describe("письмо опроса в чате перерисовывается после голоса в мини-аппе", () => {
  it("голос Игоря — его письмо правится с отметкой и «✓» на выбранной кнопке", async () => {
    const { app, api, sent, igor, anyaT, igorT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const igorMessage = sent.find((m) => m.to === 101)!.id;
    const res = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(igorT, { choice: "against" })));
    expect(res.status).toBe(200);
    type EditCall = [number, number, string, { reply_markup: { inline_keyboard: { text: string }[][] } }];
    await vi.waitFor(() => expect(api.editMessageText).toHaveBeenCalledTimes(1));
    const [to, messageId, text, extra] = api.editMessageText.mock.calls[0] as unknown as EditCall;
    expect([to, messageId]).toEqual([101, igorMessage]);
    expect(text).toContain("Твой голос: 👎 Против");
    const buttons = extra.reply_markup.inline_keyboard.flat().map((b) => b.text);
    expect(buttons).toContain("✓ 👎 Против");
    expect(buttons).not.toContain("🔒 Закрыть опрос");
  });
});

/**
 * «Напомнить молчащим» — зеркало «Напомнить не сдавшим» у заказа: те же коды,
 * тот же замок от двойной рассылки, тот же вид ответа и запись в журнале.
 */
describe("«Напомнить молчащим» по HTTP", () => {
  const remind = (id: number, token: string) => new Request(`http://x/api/polls/${id}/remind`, send(token, {}));
  async function openPoll(app: Awaited<ReturnType<typeof stage>>["app"], anyaT: string, ids: number[], closesTime: string | null = null) {
    return (await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime, audience: { kind: "picked", employeeIds: ids } })))).json()).poll as { id: number };
  }

  it("уходит только не ответившим, от запускающего; ответ «D из N»; пишет аудит", async () => {
    const { db, app, sent, anya, igor, anyaT, igorT } = await stage();
    const mark = db.select().from(employees).where(eq(employees.displayName, "Марк")).get()!.id;
    const poll = await openPoll(app, anyaT, [igor, mark]);
    await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(igorT, { choice: "for" })));
    await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(anyaT, { choice: "for" })));
    const res = await app.request(remind(poll.id, anyaT));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 1, silent: 1, unreachable: [] });
    expect(sent.filter((m) => m.text.startsWith("🔔")).map((m) => m.to)).toEqual([102]);
    const row = listRecentAudit(db, 10).find((r) => r.type === "poll_reminded");
    expect(row?.actorEmployeeId).toBe(anya);
    expect(row?.payload).toMatchObject({ pollId: poll.id, question: "Пицца?", delivered: 1, unreachable: 0 });
  });

  it("адресат, а не запускающий и не админ, — 409 с причиной, ничего не уходит; админ — может", async () => {
    const { db, app, sent, igor, anyaT, igorT } = await stage();
    const poll = await openPoll(app, anyaT, [igor]);
    const denied = await app.request(remind(poll.id, igorT));
    expect(denied.status).toBe(409);
    expect((await denied.json()).error).toBe("Напомнить может только тот, кто запустил опрос.");
    expect(sent.filter((m) => m.text.startsWith("🔔"))).toHaveLength(0);
    db.update(employees).set({ isAdmin: true }).where(eq(employees.id, igor)).run();
    const asAdmin = await app.request(remind(poll.id, igorT));
    expect(asAdmin.status).toBe(200);
  });

  it("посторонний — 404, как у остальных ручек опроса", async () => {
    const { app, igor, anyaT, markT } = await stage();
    const poll = await openPoll(app, anyaT, [igor]);
    const res = await app.request(remind(poll.id, markT));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Опрос не найден.");
  });

  it("закрытый и отменённый — 409: голос уже не примут, напоминать не о чем", async () => {
    const { app, sent, igor, anyaT } = await stage();
    const closed = await openPoll(app, anyaT, [igor]);
    await app.request(new Request(`http://x/api/polls/${closed.id}/close`, send(anyaT, {})));
    const r1 = await app.request(remind(closed.id, anyaT));
    expect(r1.status).toBe(409);
    expect((await r1.json()).error).toBe("Опрос закрыт — напоминать уже не о чем.");
    const cancelled = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Суши?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    await app.request(new Request(`http://x/api/polls/${cancelled.poll.id}/cancel`, send(anyaT, {})));
    const r2 = await app.request(remind(cancelled.poll.id, anyaT));
    expect(r2.status).toBe(409);
    expect((await r2.json()).error).toBe("Опрос отменён — напоминать не о чем.");
    expect(sent.filter((m) => m.text.startsWith("🔔"))).toHaveLength(0);
  });

  it("срок прошёл, а тик ещё не закрыл — тоже 409 «закрыт»: голос уже не примут", async () => {
    const { app, sent, igor, anyaT } = await stage();
    // 12:00 команды; срок 12:30 — потом часы уходят на 13:00.
    const poll = await openPoll(app, anyaT, [igor], "12:30");
    vi.setSystemTime(new Date("2026-09-29T10:00:00Z"));
    const res = await app.request(remind(poll.id, anyaT));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Опрос закрыт — напоминать уже не о чем.");
    expect(sent.filter((m) => m.text.startsWith("🔔"))).toHaveLength(0);
  });

  it("второй «Напомнить», пока первый рассылается, — 409 «Рассылка уже идёт — подожди.»; замок снимается", async () => {
    const { app, sent, hold, igor, anyaT } = await stage();
    const poll = await openPoll(app, anyaT, [igor]);
    const gate = hold();
    const first = app.request(remind(poll.id, anyaT));
    await vi.waitFor(() => expect(gate.waiting()).toBeGreaterThan(0));
    const second = await app.request(remind(poll.id, anyaT));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("Рассылка уже идёт — подожди.");
    gate.release();
    expect((await first).status).toBe(200);
    // Молчат двое — Аня и Игорь: одна волна, два письма.
    expect(sent.filter((m) => m.text.startsWith("🔔"))).toHaveLength(2);
    expect((await app.request(remind(poll.id, anyaT))).status).toBe(200);
  });
});
