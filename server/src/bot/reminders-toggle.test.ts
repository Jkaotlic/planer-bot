import { describe, it, expect, vi } from "vitest";
import { recordApi, stubBotInfo } from "./testbot";
import { makeTestDb } from "../db/testdb";
import { createBot, remindersKeyboard, remindersStateText } from "./bot";
import { createEmployee, linkTelegramAccount, getEmployeeById } from "../repo/employees";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

/** A bot whose outgoing calls are captured instead of sent. */
function testBot(db: Db) {
  const bot = stubBotInfo(createBot({ db, config }), { id: 42, first_name: "P", username: "p_bot" });
  const { calls } = recordApi(bot);
  return { bot, calls };
}

function worker(db: Db, name: string, tgId: number) {
  createEmployee(db, { displayName: name, inviteToken: `inv-${tgId}` });
  return linkTelegramAccount(db, `inv-${tgId}`, tgId)!;
}

const tapUpdate = (tgId: number, data: string) => ({
  update_id: tgId * 10,
  callback_query: {
    id: String(tgId),
    from: { id: tgId, is_bot: false, first_name: "T" },
    chat_instance: "1",
    data,
    message: {
      message_id: 7,
      date: 1_712_803_046,
      chat: { id: tgId, first_name: "T", type: "private" as const },
      text: "🌅 Привет!",
    },
  },
});

const commandUpdate = (tgId: number, text: string) => ({
  update_id: tgId * 10 + 1,
  message: {
    message_id: 8,
    from: { id: tgId, is_bot: false, first_name: "T" },
    chat: { id: tgId, first_name: "T", type: "private" as const },
    date: 1_712_803_046,
    text,
    entities: [{ offset: 0, length: text.split(" ")[0]!.length, type: "bot_command" as const }],
  },
});

describe("the reminders switch in the bot", () => {
  it("turns a person's own reminders off when they tap the button", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Смирнова Аня", 201);
    const { bot } = testBot(db);

    await bot.handleUpdate(tapUpdate(201, "reminders:off") as never);
    expect(getEmployeeById(db, anya.id)!.remindersEnabled).toBe(false);
  });

  it("turns them back on — the decision is reversible from the same message", async () => {
    const db = makeTestDb();
    const anya = worker(db, "Смирнова Аня", 202);
    const { bot } = testBot(db);

    await bot.handleUpdate(tapUpdate(202, "reminders:off") as never);
    await bot.handleUpdate(tapUpdate(202, "reminders:on") as never);
    expect(getEmployeeById(db, anya.id)!.remindersEnabled).toBe(true);
  });

  it("mutes only the person who tapped, never a colleague", async () => {
    // The callback data carries no employee id on purpose: the only person a tap
    // can affect is whoever's Telegram account sent it.
    const db = makeTestDb();
    const anya = worker(db, "Смирнова Аня", 203);
    const igor = worker(db, "Петров Игорь", 204);
    const { bot } = testBot(db);

    await bot.handleUpdate(tapUpdate(203, "reminders:off") as never);

    expect(getEmployeeById(db, anya.id)!.remindersEnabled).toBe(false);
    expect(getEmployeeById(db, igor.id)!.remindersEnabled).toBe(true);
  });

  it("leaves the reminder text alone and swaps only the button", async () => {
    // Rewriting the message would delete tomorrow's shift time, which is the
    // part the person actually needed.
    const db = makeTestDb();
    worker(db, "Смирнова Аня", 205);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(tapUpdate(205, "reminders:off") as never);

    expect(calls.some((c) => c.method === "editMessageText")).toBe(false);
    expect(calls.some((c) => c.method === "editMessageReplyMarkup")).toBe(true);
  });

  it("says where to get them back", async () => {
    const db = makeTestDb();
    worker(db, "Смирнова Аня", 206);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(tapUpdate(206, "reminders:off") as never);
    const replies = calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    expect(replies.join("\n")).toMatch(/notifications|мини-апп/i);
  });

  it("still says where to get them back even when the cosmetic button-swap fails", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    worker(db, "Смирнова Аня", 209);
    const bot = createBot({ db, config });
    stubBotInfo(bot, { first_name: "P", username: "p_bot" });
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    bot.api.config.use((_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      if (method === "editMessageReplyMarkup") throw new Error("telegram down");
      return { ok: true, result: {} } as never;
    });

    try {
      await bot.handleUpdate(tapUpdate(209, "reminders:off") as never);
      const replies = calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
      expect(replies.join("\n")).toMatch(/notifications|мини-апп/i);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("ignores a tap from somebody who isn't in the system", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(tapUpdate(999, "reminders:off") as never);
    expect(calls.some((c) => c.method === "sendMessage")).toBe(false);
  });
});

describe("/notifications", () => {
  it("shows the current state and the button that flips it", async () => {
    const db = makeTestDb();
    worker(db, "Смирнова Аня", 207);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(commandUpdate(207, "/notifications") as never);
    const reply = calls.find((c) => c.method === "sendMessage")!;
    expect(String(reply.payload.text)).toContain("включены");
    expect(reply.payload.reply_markup).toBeTruthy();
  });

  /**
   * Выключение касается только вечерних напоминаний. Чек-лист дежурного уходит
   * всё равно — и человек должен узнать об этом от бота, а не из тишины: пока
   * флаг был общим, трое отписались от «напоминалок» и на месяц потеряли рабочую
   * инструкцию, ни разу об этом не узнав (2026-08-28).
   */
  it("говорит, что чек-листы дежурного продолжат приходить", () => {
    expect(remindersStateText(false)).toMatch(/чек-лист/i);
  });

  it("reports «выключены» once they are off", async () => {
    const db = makeTestDb();
    worker(db, "Смирнова Аня", 208);
    const { bot, calls } = testBot(db);

    await bot.handleUpdate(tapUpdate(208, "reminders:off") as never);
    await bot.handleUpdate(commandUpdate(208, "/notifications") as never);

    const texts = calls.filter((c) => c.method === "sendMessage").map((c) => String(c.payload.text));
    expect(texts.at(-1)).toContain("выключены");
  });

  it("tells a stranger to /start rather than silently doing nothing", async () => {
    const db = makeTestDb();
    const { bot, calls } = testBot(db);
    await bot.handleUpdate(commandUpdate(998, "/notifications") as never);
    expect(String(calls.find((c) => c.method === "sendMessage")!.payload.text)).toContain("/start");
  });
});

describe("remindersStateText / remindersKeyboard", () => {
  it("offers the opposite of the current state — a switch, not a label", () => {
    expect(remindersStateText(true)).toContain("включены");
    expect(remindersStateText(false)).toContain("выключены");

    const whenOn = JSON.stringify(remindersKeyboard(true).inline_keyboard);
    const whenOff = JSON.stringify(remindersKeyboard(false).inline_keyboard);
    expect(whenOn).toContain("reminders:off");
    expect(whenOff).toContain("reminders:on");
  });

  it("names all three shifts reminders actually cover — morning, evening and night (see shared/src/reminder.ts's isReminderWorthy)", () => {
    // The plain day shift is the only one that's silent; morning, evening and
    // night all get a reminder. The old wording named only two of the three.
    const text = remindersStateText(true);
    expect(text).toContain("утренней");
    expect(text).toContain("вечерней");
    expect(text).toContain("ночной");
  });
});
