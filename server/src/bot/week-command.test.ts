import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot, WEEK_OFFSET_LIMIT } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee, getByTelegramId } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { addDaysIso, mondayOfIso, formatWeekRangeLabelIso } from "@planer/shared";
import { teamNow } from "../util/team-time";
import type { Config } from "../config";
import type { Db } from "../db/client";

const config: Config = {
  botToken: "12345:tok", adminTelegramIds: [111], teamTz: "Europe/Moscow",
  databaseUrl: ":memory:", jwtSecret: "test-jwt-secret-that-is-long-enough-0123", publicUrl: "https://x.keenetic.pro",
};

function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    return { ok: true, result: {} } as any;
  });
  return { bot, calls };
}

function commandUpdate(tgId: number, text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 4, date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: text.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** The same command, but arriving from a group the bot was added to. */
function groupCommandUpdate(tgId: number, text: string) {
  return {
    update_id: 1,
    message: {
      message_id: 4, date: 1_712_803_046,
      chat: { id: -1_001_234_567, title: "Смены", type: "supergroup" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: text.length }],
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Like testBot, but the given API method throws on every call — used to prove
 *  a failed acknowledgement after a successful redraw doesn't turn into a
 *  second, live answerCallbackQuery call for the same tap. */
function testBotFailingMethod(db: Db, failingMethod: string) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const calls: { method: string; payload: any }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    calls.push({ method, payload });
    if (method === failingMethod) throw new Error("telegram down");
    return { ok: true, result: {} } as any;
  });
  return { bot, calls };
}

function callbackUpdate(tgId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "cbq-1",
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: {
        message_id: 5, date: 1_712_803_046,
        chat: { id: tgId, first_name: "T", type: "private" as const },
      },
      chat_instance: "x",
      data,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Like callbackUpdate, but the message the tapped button is attached to sits
 *  in a group rather than a DM — the message.chat is what the handler's guard
 *  reads, not who tapped it, so this is the case that guard exists for. */
function groupCallbackUpdate(tgId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "cbq-1",
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: {
        message_id: 5, date: 1_712_803_046,
        chat: { id: -1_001_234_567, title: "Смены", type: "supergroup" as const },
      },
      chat_instance: "x",
      data,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Creates a linked worker with a Telegram account and one shift this week. */
function linkedWorker(db: Db, tgId: number) {
  createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  const linked = getByTelegramId(db, tgId)!;
  createShift(db, { employeeId: linked.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
  return linked;
}

/**
 * The caption `buildWeekImage` produces for the week `offsetWeeks` away from
 * today, computed with the same date functions the handler itself uses. This
 * mirrors the handler's own arithmetic rather than a hardcoded date, so the
 * test still tells the truth on any day it happens to run, and it fails if
 * the handler's `offset * 7` multiplier ever regresses to a flat `0`.
 */
function expectedCaption(offsetWeeks: number): string {
  const today = teamNow(config.teamTz).date;
  const monday = addDaysIso(mondayOfIso(today), offsetWeeks * 7);
  const sunday = addDaysIso(monday, 6);
  return `Команда · ${formatWeekRangeLabelIso(monday, sunday)}`;
}

describe("/week", () => {
  it("незарегистрированному предлагает /start и фото не шлёт", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(999, "/week"));
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toContain("/start");
  });

  it("архивному отказывает", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 222);
    archiveEmployee(db, worker.id, "2026-08-06"); // third argument is required
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(222, "/week"));
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
    expect(calls.find((call) => call.method === "sendMessage")?.payload.text).toContain("архиве");
  });

  it("в группе не отвечает ничем — весь ростер туда не выкладывается", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1212); // a real worker, so it is the chat type that stops it
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCommandUpdate(1212, "/week"));
    expect(calls).toEqual([]);
  });

  it("работнику шлёт фото с кнопками листания", async () => {
    const db = makeTestDb();
    linkedWorker(db, 333);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(333, "/week"));

    const photo = calls.find((call) => call.method === "sendPhoto");
    expect(photo).toBeDefined();
    const buttons = photo!.payload.reply_markup.inline_keyboard.flat();
    expect(buttons.map((b: { callback_data: string }) => b.callback_data)).toEqual(["week:-1", "week:1"]);
  });

  it("на текущей неделе кнопки «Текущая» нет, а на соседней есть", async () => {
    const db = makeTestDb();
    linkedWorker(db, 444);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(commandUpdate(444, "/week"));
    const firstPhoto = calls.find((call) => call.method === "sendPhoto")!;
    expect(JSON.stringify(firstPhoto.payload.reply_markup)).not.toContain("week:0");

    await bot.handleUpdate(callbackUpdate(444, "week:1"));
    const redrawn = calls.find((call) => call.method === "editMessageMedia")!;
    expect(JSON.stringify(redrawn.payload.reply_markup)).toContain("week:0");
  });

  it("подпись картинки соответствует показанной неделе, а не неделе отправки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 777);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(commandUpdate(777, "/week"));
    const photo = calls.find((call) => call.method === "sendPhoto")!;
    expect(photo.payload.caption).toBe(expectedCaption(0));

    await bot.handleUpdate(callbackUpdate(777, "week:1"));
    const redrawn = calls.find((call) => call.method === "editMessageMedia")!;
    expect(redrawn.payload.media.caption).toBe(expectedCaption(1));
    expect(redrawn.payload.media.caption).not.toBe(photo.payload.caption);
  });

  it("листание перерисовывает фото, а не шлёт новое", async () => {
    const db = makeTestDb();
    linkedWorker(db, 555);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(555, "week:-2"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(true);
    expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
  });

  it("за границей диапазона отвечает тостом и картинку не трогает", async () => {
    const db = makeTestDb();
    linkedWorker(db, 666);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(666, "week:99"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(false);
    expect(calls.find((call) => call.method === "answerCallbackQuery")?.payload.text).toContain("Дальше не листаю");
  });

  it("подтверждение после успешной перерисовки падает — второй раз не отвечает и не роняет обработчик", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1010);
    const { bot, calls } = testBotFailingMethod(db, "answerCallbackQuery");

    // Must not reject: a thrown answerCallbackQuery here used to fall into the
    // catch block, which retried the same call and either threw again
    // (escaping the handler) or answered a second time for one tap.
    await bot.handleUpdate(callbackUpdate(1010, "week:1"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(true);
    expect(calls.filter((call) => call.method === "answerCallbackQuery")).toHaveLength(1);
  });

  it("на самой границе диапазона ещё перерисовывает", async () => {
    const db = makeTestDb();
    linkedWorker(db, 888);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(888, `week:${WEEK_OFFSET_LIMIT}`));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(true);
  });

  it("на один шаг за границей уже отказывает", async () => {
    const db = makeTestDb();
    linkedWorker(db, 999);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(callbackUpdate(999, `week:${WEEK_OFFSET_LIMIT + 1}`));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(false);
    expect(calls.find((call) => call.method === "answerCallbackQuery")?.payload.text).toContain("Дальше не листаю");
  });

  it("тап в группе не перерисовывает ростер — только тост", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1313); // a real worker, so it is the chat guard that stops this, not acting()
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCallbackUpdate(1313, "week:1"));

    expect(calls.some((call) => call.method === "editMessageMedia")).toBe(false);
    expect(calls.find((call) => call.method === "answerCallbackQuery")?.payload.text).toBe("Только в личном чате");
  });
});
