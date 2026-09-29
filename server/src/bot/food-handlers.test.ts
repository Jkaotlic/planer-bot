import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { recordApi, stubBotInfo } from "./testbot";
import { BTN_FOOD } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { castVote, closePoll, createPoll, getPoll, voteOf } from "../polls/poll-service";
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
  const bot = stubBotInfo(createBot({ db, config }), { id: 1, first_name: "P", username: "p_bot" });
  return { db, bot, anya, igor, mark, poll };
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

  it("«Итоги» показывает счёт всплывашкой", async () => {
    const { db, bot, igor, poll } = stage();
    castVote(db, poll, igor.id, "for", { date: "2026-09-29", time: "12:00" });
    const api = recordApi(bot);
    await tap(bot, 333, `poll:r:${poll.id}`);
    expect(api.answers.join(" ")).toMatch(/За 1 · Против 0 · Воздержались 0 · Молчат 1/);
  });

  it("«Закрыть опрос» у запускающего закрывает и рассылает итог, у участника — отказ", async () => {
    const { db, bot, poll } = stage();
    const api = recordApi(bot);
    await tap(bot, 333, `poll:close:${poll.id}`);
    expect(getPoll(db, poll.id)!.closedAt).toBeNull();
    await tap(bot, 111, `poll:close:${poll.id}`);
    expect(getPoll(db, poll.id)!.closedAt).not.toBeNull();
    expect(api.sent.filter((m) => m.text.includes("Итоги опроса"))).toHaveLength(2);
  });
});
