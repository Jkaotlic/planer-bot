import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";
import { sql } from "drizzle-orm";
import { polls } from "../../db/schema";

function fakeBot() {
  const sent: { to: number; text: string; id: number }[] = [];
  let nextId = 1;
  // Задвижка «медленной сети»: пока она стоит, каждый `sendMessage` ждёт —
  // рассылка висит внутри запроса, как на обрыве релея.
  let gate: Promise<void> | null = null;
  let waiting = 0;
  const bot = {
    api: {
      sendMessage: vi.fn(async (to: number, text: string) => {
        if (gate) { waiting += 1; await gate; }
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
  return { bot: bot as unknown as Bot, sent, hold, api: bot.api };
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

async function stage() {
  const db = makeTestDb();
  const { bot, sent, hold, api } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  person(db, "Марк", 102);
  return { db, app, sent, hold, api, anya, igor, anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102) };
}

describe("опросы по HTTP", () => {
  it("работник создаёт опрос вручную выбранным — письма уходят ему и адресату", async () => {
    const { app, sent, igor, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: "18:00", audience: { kind: "picked", employeeIds: [igor] } })));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.delivered).toBe(2);
    expect(body.poll.closes).toBe("до 18:00");
    expect(sent.map((m) => m.to).sort()).toEqual([100, 101]);
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

  it("срок в прошлом — 400, ничего не уходит", async () => {
    // Системное время подделано на 09:00 UTC = 12:00 команды (MSK): 08:00 уже прошло.
    const { app, sent, igor, anyaT } = await stage();
    const res = await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: "08:00", audience: { kind: "picked", employeeIds: [igor] } })));
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
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
  });

  it("голое null вместо тела голоса — 400, а не падение", async () => {
    const { app, igor, anyaT, igorT } = await stage();
    const { poll } = await (await app.request(new Request("http://x/api/polls",
      send(anyaT, { question: "Пицца?", closesTime: null, audience: { kind: "picked", employeeIds: [igor] } })))).json();
    const res = await app.request(new Request(`http://x/api/polls/${poll.id}/vote`, send(igorT, null)));
    expect(res.status).toBe(400);
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
