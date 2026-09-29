import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Bot } from "grammy";
import { createApp } from "../app";
import { makeTestDb } from "../../db/testdb";
import { createEmployee, linkTelegramAccount } from "../../repo/employees";
import { signInitData } from "../../auth/telegram";
import { testConfig } from "../../test-config";
import type { Db } from "../../db/client";

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

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-29T09:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });

async function stage() {
  const db = makeTestDb();
  const { bot, sent } = fakeBot();
  const app = createApp({ db, config, bot });
  const anya = person(db, "Аня", 100);
  const igor = person(db, "Игорь", 101);
  person(db, "Марк", 102);
  return { db, app, sent, anya, igor, anyaT: await tokenFor(app, 100), igorT: await tokenFor(app, 101), markT: await tokenFor(app, 102) };
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
});
