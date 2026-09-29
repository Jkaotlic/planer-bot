import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import type { Db } from "../db/client";
import { castVote, closePoll, createPoll, getPoll, pollRecipientRows } from "./poll-service";
import { finishPollMessages, sendPollInvites } from "./poll-messenger";

const now = { date: "2026-09-29", time: "12:00" };

function person(db: Db, name: string, tg: number) {
  const e = createEmployee(db, { displayName: name, inviteToken: `inv-${name}` });
  linkTelegramAccount(db, `inv-${name}`, tg);
  return { id: e.id, isAdmin: false };
}

describe("рассылка опроса", () => {
  it("каждому адресату уходит письмо с тремя кнопками; у запускающего ещё «Закрыть»", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: "2026-09-29T18:00", recipientIds: [anya.id, igor.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    expect(await sendPollInvites(bot, db, poll, now)).toBe(2);
    const toAnya = api.sent.find((m) => m.chat_id === 100)!;
    const toIgor = api.sent.find((m) => m.chat_id === 101)!;
    expect(toIgor.text).toContain("Аня спрашивает");
    expect(toIgor.text).toContain("до 18:00");
    const buttons = (m: typeof toIgor) => (m.reply_markup?.inline_keyboard ?? []).flat().map((b: { text: string }) => b.text);
    expect(buttons(toIgor)).toEqual(["👍 За", "👎 Против", "🤷 Воздержался", "📊 Итоги"]);
    expect(buttons(toAnya)).toContain("🔒 Закрыть опрос");
  });

  it("при закрытии всем адресатам уходит итог с именами", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id] });
    castVote(db, poll, igor.id, "for", now);
    closePoll(db, poll, anya);
    const { bot } = silentBot();
    const api = recordApi(bot);
    await finishPollMessages(bot, db, getPoll(db, poll.id)!, "closed");
    const results = api.sent.filter((m) => m.text.includes("Итоги опроса"));
    expect(results.map((m) => m.chat_id).sort()).toEqual([100, 101]);
    expect(results[0]!.text).toContain("👍 За — 1: Игорь");
    expect(pollRecipientRows(db, poll.id)).toHaveLength(2);
  });
});
