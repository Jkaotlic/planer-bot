import { describe, it, expect } from "vitest";
import type { Bot } from "grammy";
import { createBot } from "./bot";
import { BTN_WEEK, BTN_REMINDERS, BTN_ADMIN } from "./keyboard";
import { makeTestDb } from "../db/testdb";
import {
  createEmployee,
  linkTelegramAccount,
  getByTelegramId,
  archiveEmployee,
  setEmployeeAdmin,
} from "../repo/employees";
import { createShift } from "../repo/shifts";
import type { Config } from "../config";
import type { Db } from "../db/client";

// 111 — единственный аллоулистнутый id в этих тестах; все остальные обычные люди.
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

/** Та же команда, но пришедшая из группы, куда бот добавлен. */
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

/** Привязанный работник с одной сменой — чтобы /week было что рисовать. */
function linkedWorker(db: Db, tgId: number) {
  createEmployee(db, { displayName: "Иванов Иван", inviteToken: `tok-${tgId}` });
  linkTelegramAccount(db, `tok-${tgId}`, tgId, "ivanov", "Иван");
  const linked = getByTelegramId(db, tgId)!;
  createShift(db, { employeeId: linked.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
  return linked;
}

/** Метки клавиатуры из перехваченного payload, или null — если её там нет. */
function keyboardLabels(payload: any): string[] | null {
  const kb = payload?.reply_markup?.keyboard;
  if (!kb) return null;
  return kb.flat().map((btn: { text: string }) => btn.text);
}

describe("постоянная клавиатура — доставка", () => {
  it("привязанный работник получает её на /start, без кнопки админки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 222);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(222, "/start"));

    const labels = keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload);
    expect(labels).toContain(BTN_WEEK);
    expect(labels).not.toContain(BTN_ADMIN);
  });

  it("в группу не уходит — её увидели бы все участники", async () => {
    const db = makeTestDb();
    linkedWorker(db, 333);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupCommandUpdate(333, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toBeNull();
  });

  it("незнакомцу не уходит — нажимать ему нечего", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(999, "/start"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("не зарегистрирован");
    expect(keyboardLabels(reply.payload)).toBeNull();
  });

  it("архивному не уходит, а текст отказа не меняется", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 444);
    archiveEmployee(db, worker.id, "2026-08-06");
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(444, "/start"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("архиве");
    expect(keyboardLabels(reply.payload)).toBeNull();
  });

  it("админ получает кнопку админки", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 555);
    setEmployeeAdmin(db, worker.id, true);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(555, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toContain(BTN_ADMIN);
  });

  it("аллоулистнутый получает кнопку админки ещё до того, как его строка стала админской", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 111);
    expect(worker.isAdmin).toBe(false); // строка ещё обычная — /admin повысит её только при обращении
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(111, "/start"));

    expect(keyboardLabels(calls.find((c) => c.method === "sendMessage")?.payload)).toContain(BTN_ADMIN);
  });

  it("отказ /admin обычному работнику приходит с клавиатурой, но без кнопки админки", async () => {
    const db = makeTestDb();
    linkedWorker(db, 666);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(666, "/admin"));

    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(reply.payload.text).toContain("только администраторам");
    expect(keyboardLabels(reply.payload)).toContain(BTN_REMINDERS);
    expect(keyboardLabels(reply.payload)).not.toContain(BTN_ADMIN);
  });

  it("ссылка на админку приходит с клавиатурой и по-прежнему без превью", async () => {
    const db = makeTestDb();
    const worker = linkedWorker(db, 777);
    setEmployeeAdmin(db, worker.id, true);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(777, "/admin"));

    const reply = calls.find((c) => c.method === "sendMessage" && String(c.payload.text).includes("/admin/#token="))!;
    expect(reply.payload.link_preview_options).toEqual({ is_disabled: true });
    expect(keyboardLabels(reply.payload)).toContain(BTN_ADMIN);
  });
});

/** Нажатая кнопка приходит обычным текстом — без entity `bot_command`. */
function textUpdate(tgId: number, text: string) {
  return {
    update_id: 3,
    message: {
      message_id: 7, date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

/** Тот же текст, но из группы. */
function groupTextUpdate(tgId: number, text: string) {
  return {
    update_id: 3,
    message: {
      message_id: 7, date: 1_712_803_046,
      chat: { id: -1_001_234_567, title: "Смены", type: "supergroup" as const },
      from: { id: tgId, is_bot: false, first_name: "T" },
      text,
    },
  } as unknown as Parameters<Bot["handleUpdate"]>[0];
}

describe("постоянная клавиатура — нажатия", () => {
  it("«График» отвечает тем же, чем /week", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1001);

    const viaCommand = testBot(db);
    await viaCommand.bot.handleUpdate(commandUpdate(1001, "/week"));
    const fromCommand = viaCommand.calls.find((c) => c.method === "sendPhoto");

    const viaButton = testBot(db);
    await viaButton.bot.handleUpdate(textUpdate(1001, BTN_WEEK));
    const fromButton = viaButton.calls.find((c) => c.method === "sendPhoto");

    expect(fromCommand?.payload.caption).toBeDefined();
    expect(fromButton?.payload.caption).toBe(fromCommand?.payload.caption);
    expect(JSON.stringify(fromButton?.payload.reply_markup)).toBe(
      JSON.stringify(fromCommand?.payload.reply_markup),
    );
  });

  it("«Напоминания» отвечают тем же, чем /notifications", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1002);

    const viaCommand = testBot(db);
    await viaCommand.bot.handleUpdate(commandUpdate(1002, "/notifications"));
    const fromCommand = viaCommand.calls.find((c) => c.method === "sendMessage");

    const viaButton = testBot(db);
    await viaButton.bot.handleUpdate(textUpdate(1002, BTN_REMINDERS));
    const fromButton = viaButton.calls.find((c) => c.method === "sendMessage");

    expect(fromCommand?.payload.text).toContain("Напоминания о сменах");
    expect(fromButton?.payload.text).toBe(fromCommand?.payload.text);
    expect(JSON.stringify(fromButton?.payload.reply_markup)).toBe(
      JSON.stringify(fromCommand?.payload.reply_markup),
    );
  });

  it("«Админка» от не-админа отказывает так же, как команда", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1003);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(textUpdate(1003, BTN_ADMIN));

    expect(calls.find((c) => c.method === "sendMessage")?.payload.text).toContain("только администраторам");
  });

  it("«График» из группы не отвечает ничем — иначе кнопка обходила бы защиту /week", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1004);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(groupTextUpdate(1004, BTN_WEEK));

    expect(calls).toEqual([]);
  });

  it("на произвольный текст бот молчит, как молчал", async () => {
    const db = makeTestDb();
    linkedWorker(db, 1005);
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(textUpdate(1005, "привет"));

    expect(calls).toEqual([]);
  });
});
