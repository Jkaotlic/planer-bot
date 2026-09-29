import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { recordApi, silentBot } from "../bot/testbot";
import type { Db } from "../db/client";
import { castVote, closePoll, createPoll, getPoll, pollRecipientRows } from "./poll-service";
import { finishPollMessages, redrawPollMessage, sendPollInvites } from "./poll-messenger";

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

  it("при закрытии всем адресатам уходит итог с именами и гасятся кнопки именно в их письмах", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    // Разослать приглашения — иначе у адресатов нет `messageId`, и гасить нечего.
    await sendPollInvites(bot, db, poll, now);
    castVote(db, poll, igor.id, "for", now);
    closePoll(db, poll, anya);
    await finishPollMessages(bot, db, getPoll(db, poll.id)!, "closed");

    const results = api.sent.filter((m) => m.text.includes("Итоги опроса"));
    expect(results.map((m) => m.chat_id).sort()).toEqual([100, 101]);
    expect(results[0]!.text).toContain("👍 За — 1: Игорь");

    // Гашение — по конкретному `message_id` каждого адресата, а не оптом: тест
    // на пассивное «строк в базе столько же» ничего не сказал бы про сам вызов.
    const recipients = pollRecipientRows(db, poll.id);
    const edits = api.calls.filter((c) => c.method === "editMessageReplyMarkup");
    expect(edits).toHaveLength(2);
    for (const r of recipients) {
      const edit = edits.find((e) => e.payload.chat_id === r.telegramUserId);
      expect(edit?.payload.message_id).toBe(r.messageId);
    }
  });

  it("итог доходит до всех, даже если гашение кнопок у одного из адресатов упало", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id] });
    const { bot } = silentBot();
    await sendPollInvites(bot, db, poll, now);
    closePoll(db, poll, anya);

    // Письмо могли удалить между рассылкой и закрытием — правка кнопок тогда
    // падает у Telegram. Свой транспорт поверх `silentBot`: он и кидает на
    // гашении, и параллельно записывает, что реально ушло `sendMessage`.
    const sent: { chat_id: number; text: string }[] = [];
    bot.api.config.use((_prev, method, payload) => {
      if (method === "editMessageReplyMarkup") throw new Error("message to edit not found");
      if (method === "sendMessage") sent.push(payload as { chat_id: number; text: string });
      return { ok: true, result: {} } as never;
    });

    await finishPollMessages(bot, db, getPoll(db, poll.id)!, "closed");
    expect(sent.map((m) => m.chat_id).sort()).toEqual([100, 101]);
    expect(sent.every((m) => m.text.includes("Итоги опроса"))).toBe(true);
  });
});

describe("перерисовка письма опроса", () => {
  it("открытый — правит письмо именно этого человека; закрытый — не трогает (кнопки уже погашены)", async () => {
    const db = makeTestDb();
    const anya = person(db, "Аня", 100);
    const igor = person(db, "Игорь", 101);
    const poll = createPoll(db, { createdBy: anya.id, question: "Пицца?", closesAt: null, recipientIds: [anya.id, igor.id] });
    const { bot } = silentBot();
    const api = recordApi(bot);
    await sendPollInvites(bot, db, poll, now);
    const igorMessage = pollRecipientRows(db, poll.id).find((r) => r.employeeId === igor.id)!.messageId;
    castVote(db, poll, igor.id, "for", now);
    await redrawPollMessage(bot, db, poll, igor.id, now);
    const edits = api.calls.filter((c) => c.method === "editMessageText");
    expect(edits.map((c) => [c.payload.chat_id, c.payload.message_id])).toEqual([[101, igorMessage]]);
    closePoll(db, poll, anya);
    await redrawPollMessage(bot, db, getPoll(db, poll.id)!, igor.id, now);
    expect(api.calls.filter((c) => c.method === "editMessageText")).toHaveLength(1);
  });
});
