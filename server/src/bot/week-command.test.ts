import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, archiveEmployee, getByTelegramId } from "../repo/employees";
import { createShift } from "../repo/shifts";
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

/** Creates a linked worker with a Telegram account and one shift this week. */
function linkedWorker(db: Db, tgId: number) {
  const employee = createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  const linked = getByTelegramId(db, tgId)!;
  createShift(db, { employeeId: linked.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
  return linked;
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
});
