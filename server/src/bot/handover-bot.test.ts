import { describe, it, expect } from "vitest";
import { createBot } from "./bot";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, createAdminEmployee } from "../repo/employees";
import { getShift } from "../repo/shifts";
import { getHandover, listDeclines } from "../repo/handovers";
import { shifts, type Shift } from "../db/schema";
import { startHandovers, offerTo } from "../handover/handover-service";
import { createHandoverMessenger } from "../handover/handover-messenger";
import { testConfig } from "../test-config";
import type { Db } from "../db/client";

const config = testConfig();

interface SentMessage {
  chat_id: number | string;
  text: string;
  reply_markup?: { inline_keyboard: { text: string; callback_data?: string }[][] };
}

function testBot(db: Db) {
  const bot = createBot({ db, config });
  bot.botInfo = {
    id: 42, is_bot: true, first_name: "Planer", username: "planer_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false,
  } as unknown as typeof bot.botInfo;
  const sent: SentMessage[] = [];
  const answers: string[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as SentMessage);
    if (method === "answerCallbackQuery") answers.push((payload as { text?: string }).text ?? "");
    return { ok: true, result: {} } as never;
  });
  return { bot, sent, answers };
}

function callbackUpdate(tgId: number, data: string) {
  return {
    update_id: 2,
    callback_query: {
      id: "cbq-1",
      from: { id: tgId, is_bot: false, first_name: "T" },
      message: {
        message_id: 5,
        date: 1_712_803_046,
        chat: { id: tgId, first_name: "T", type: "private" as const },
        text: "предложение",
      },
      chat_instance: "x",
      data,
    },
  };
}

/** Завтра в часовом поясе команды — чтобы смена не оказалась в прошлом. */
function tomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return new Intl.DateTimeFormat("en-CA", { timeZone: config.teamTz }).format(d);
}

function shift(db: Db, employeeId: number, date: string, start = "09:00", end = "18:00"): Shift {
  return db.insert(shifts).values({ date, start, end, category: "shift", title: "День", employeeId }).returning().get();
}

function sickLeave(db: Db, employeeId: number, date: string): Shift {
  return db.insert(shifts).values({ date, endDate: date, category: "sick_leave", employeeId }).returning().get();
}

/** Аня на больничном, у неё смена, Игорь и Марк свободны, админ на месте. */
async function scene(db: Db) {
  const admin = createAdminEmployee(db, { displayName: "Админ Админов", telegramUserId: 111 });
  // Привязка идёт через токен приглашения — тем же путём, что и живой человек:
  // подсунуть telegram_user_id мимо него значило бы проверять состояние, в
  // которое система сама себя привести не умеет.
  const anya = createEmployee(db, { displayName: "Аня Аниева", inviteToken: "tok-anya" });
  const igor = createEmployee(db, { displayName: "Игорь Игорев", inviteToken: "tok-igor" });
  const mark = createEmployee(db, { displayName: "Марк Маркин", inviteToken: "tok-mark" });
  linkTelegramAccount(db, "tok-anya", 201);
  linkTelegramAccount(db, "tok-igor", 202);
  linkTelegramAccount(db, "tok-mark", 203);

  const date = tomorrow();
  const sick = sickLeave(db, anya.id, date);
  const work = shift(db, anya.id, date);
  const deps = { db, config, messenger: createHandoverMessenger(null, db) };
  const [handover] = await startHandovers(deps, { sickEntry: sick, employeeId: anya.id });
  return { admin, anya, igor, mark, work, handover: handover!, date };
}

describe("handover buttons", () => {
  it("offers with two buttons routed to this handover", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    const { igor, handover } = await scene(db);

    await offerTo({ db, config, messenger: createHandoverMessenger(bot, db) }, handover.id, igor.id);

    const offer = sent.find((m) => m.chat_id === 202);
    expect(offer).toBeDefined();
    const buttons = offer!.reply_markup!.inline_keyboard.flat();
    expect(buttons.map((b) => b.callback_data)).toEqual([
      `handover:take:${handover.id}`,
      `handover:decline:${handover.id}`,
    ]);
  });

  it("«Беру» moves the shift and tells the tapper", async () => {
    const db = makeTestDb();
    const { bot, sent, answers } = testBot(db);
    const { igor, work, handover } = await scene(db);

    await bot.handleUpdate(callbackUpdate(202, `handover:take:${handover.id}`));

    expect(getShift(db, work.id)?.employeeId).toBe(igor.id);
    expect(getHandover(db, handover.id)?.status).toBe("taken");
    expect(answers.join(" ")).toContain("Готово");
    // Выбывшая и админы обязаны узнать — иначе смена уехала молча.
    expect(sent.map((m) => m.chat_id)).toContain(201);
    expect(sent.map((m) => m.chat_id)).toContain(111);
  });

  it("a second «Беру» is refused and changes nothing", async () => {
    const db = makeTestDb();
    const { bot, answers } = testBot(db);
    const { igor, work, handover } = await scene(db);

    await bot.handleUpdate(callbackUpdate(202, `handover:take:${handover.id}`));
    await bot.handleUpdate(callbackUpdate(203, `handover:take:${handover.id}`));

    expect(getShift(db, work.id)?.employeeId).toBe(igor.id);
    expect(answers.at(-1)).toContain("Уже");
  });

  it("«Не могу» fans out and does not write to the person who refused", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    const { igor, mark, handover } = await scene(db);
    await offerTo({ db, config, messenger: createHandoverMessenger(bot, db) }, handover.id, igor.id);
    sent.length = 0;

    await bot.handleUpdate(callbackUpdate(202, `handover:decline:${handover.id}`));

    expect(getHandover(db, handover.id)?.status).toBe("fanned");
    expect(listDeclines(db, handover.id)).toEqual([igor.id]);
    expect(sent.map((m) => m.chat_id)).toContain(203);
    expect(sent.map((m) => m.chat_id)).not.toContain(202);
    expect(mark.id).toBeGreaterThan(0);
  });

  it("the fan-out carries one button — a refusal answers nothing in a broadcast", async () => {
    const db = makeTestDb();
    const { bot, sent } = testBot(db);
    const { igor, handover } = await scene(db);
    await offerTo({ db, config, messenger: createHandoverMessenger(bot, db) }, handover.id, igor.id);
    sent.length = 0;

    await bot.handleUpdate(callbackUpdate(202, `handover:decline:${handover.id}`));

    const fan = sent.find((m) => m.chat_id === 203);
    expect(fan!.reply_markup!.inline_keyboard.flat().map((b) => b.callback_data)).toEqual([
      `handover:take:${handover.id}`,
    ]);
  });

  it("a tap from somebody the bot does not know does nothing", async () => {
    // Тот же guard, что закрыл дыру cf33022: кнопки бота были вторым входом
    // без проверки, и архивный человек мог ими пользоваться.
    const db = makeTestDb();
    const { bot, answers } = testBot(db);
    const { work, handover } = await scene(db);

    await bot.handleUpdate(callbackUpdate(999, `handover:take:${handover.id}`));

    expect(getHandover(db, handover.id)?.status).not.toBe("taken");
    expect(getShift(db, work.id)?.employeeId).not.toBe(999);
    expect(answers.join(" ")).toContain("не в системе");
  });

  it("refuses somebody whose own shift clashes, in human words", async () => {
    const db = makeTestDb();
    const { bot, answers } = testBot(db);
    const { igor, work, handover, date } = await scene(db);
    shift(db, igor.id, date, "12:00", "20:00");

    await bot.handleUpdate(callbackUpdate(202, `handover:take:${handover.id}`));

    expect(getShift(db, work.id)?.employeeId).not.toBe(igor.id);
    expect(answers.join(" ")).toContain("своя смена");
  });
});
