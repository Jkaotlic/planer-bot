import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { employees } from "../db/schema";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, updateShift, deleteShift } from "../repo/shifts";
import { hasReminder } from "../repo/reminders";
import { listRecentAudit } from "../repo/audit";
import { runReminderTick } from "./reminder-service";
import type { Db } from "../db/client";

/** Bot with botInfo set (skips getMe) and a transformer capturing outgoing sendMessage. */
function testBot() {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const sent: { chat_id: number | string; text: string }[] = [];
  bot.api.config.use((_prev, method, payload) => {
    if (method === "sendMessage") sent.push(payload as { chat_id: number | string; text: string });
    return { ok: true, result: {} } as any;
  });
  return { bot, sent };
}

/**
 * Bot whose sendMessage is refused by Telegram with a real API error, so grammY
 * raises the same `GrammyError` production sees. `attempts` counts how many calls
 * actually reached the wire — the point of the permanent-failure tests.
 */
function refusingBot(errorCode: number, description: string) {
  const bot = new Bot("12345:tok");
  bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
    can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
  const state = { attempts: 0 };
  bot.api.config.use((_prev, method) => {
    if (method === "sendMessage") {
      state.attempts += 1;
      return { ok: false, error_code: errorCode, description } as any;
    }
    return { ok: true, result: {} } as any;
  });
  return {
    bot,
    get attempts() {
      return state.attempts;
    },
  };
}

function linkedEmployee(db: Db, name: string, tgId: number) {
  const emp = createEmployee(db, { displayName: name, inviteToken: `i-${tgId}` });
  return linkTelegramAccount(db, `i-${tgId}`, tgId)!;
}

const TODAY = "2026-07-14";
const TOMORROW = "2026-07-15";

describe("runReminderTick", () => {
  it("sends an evening-before reminder for a morning shift tomorrow, with the wake time", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const shift = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chat_id).toBe(111);
    expect(sent[0]?.text).toContain("07:00"); // wake = 08:00 - 60min default prepBuffer
    expect(hasReminder(db, shift.id, "evening_before")).toBe(true);
  });

  it("is idempotent: a second tick does not resend", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    await runReminderTick(db, bot, { date: TODAY, time: "20:30" });
    const secondCount = await runReminderTick(db, bot, { date: TODAY, time: "20:35" });

    expect(secondCount).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it("does not send before 20:00 (quiet hours)", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "19:00" });

    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("skips an employee with remindersEnabled = false", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    db.update(employees).set({ remindersEnabled: false }).where(eq(employees.id, anya.id)).run();
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("does not remind for a plain day shift", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "10:00", end: "18:00", employeeId: anya.id });
    createShift(db, { date: TOMORROW, start: "09:00", end: "18:00", employeeId: anya.id }); // «День»
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("reminds the NEW owner when the shift was reassigned before the tick (recipient at send time)", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const igor = linkedEmployee(db, "Игорь", 222);
    const shift = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    updateShift(db, shift.id, { employeeId: igor.id });

    const { bot, sent } = testBot();
    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.chat_id).toBe(222);
  });

  it("does not record a reminder when the send fails, and retries on the next tick", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const shift = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    const failingBot = new Bot("12345:tok");
    failingBot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof failingBot.botInfo;
    failingBot.api.config.use((_prev, method) => {
      if (method === "sendMessage") throw new Error("boom");
      return { ok: true, result: {} } as any;
    });

    try {
      const failedCount = await runReminderTick(db, failingBot, { date: TODAY, time: "20:30" });

      expect(failedCount).toBe(0);
      expect(hasReminder(db, shift.id, "evening_before")).toBe(false);
      expect(errorLog).toHaveBeenCalledTimes(1);
      expect(errorLog).toHaveBeenCalledWith(
        "notifyReminder: failed for 111:",
        "boom",
      );

      const { bot, sent } = testBot();
      const retryCount = await runReminderTick(db, bot, { date: TODAY, time: "20:35" });

      expect(retryCount).toBe(1);
      expect(sent).toHaveLength(1);
      expect(hasReminder(db, shift.id, "evening_before")).toBe(true);
      expect(errorLog).toHaveBeenCalledTimes(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("gives up after Telegram refuses for good, and says so in the journal", async () => {
    // A blocked or deleted account refuses every time. The tick runs every five
    // minutes from 20:00, so retrying a hopeless send meant ~48 futile calls a night,
    // for as long as that person stays on the roster — and nobody ever found out they
    // stopped hearing from the bot. The birthday tick already marks-either-way for
    // exactly this reason; this path did not.
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const shift = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    try {
      const blocked = refusingBot(403, "Forbidden: bot was blocked by the user");
      expect(await runReminderTick(db, blocked.bot, { date: TODAY, time: "20:30" })).toBe(0);
      expect(blocked.attempts).toBe(1);
      expect(hasReminder(db, shift.id, "evening_before")).toBe(true); // won't be retried

      const event = listRecentAudit(db, 10).find((row) => row.type === "reminder_undeliverable");
      expect(event?.payload).toEqual({ employeeId: anya.id, displayName: "Аня", shiftId: shift.id, errorCode: 403 });

      // A later tick stays quiet instead of hammering a chat that will never open.
      const again = refusingBot(403, "Forbidden: bot was blocked by the user");
      expect(await runReminderTick(db, again.bot, { date: TODAY, time: "20:35" })).toBe(0);
      expect(again.attempts).toBe(0);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("keeps retrying when Telegram is merely busy (429), and journals nothing", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const shift = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    try {
      const busy = refusingBot(429, "Too Many Requests: retry after 5");
      expect(await runReminderTick(db, busy.bot, { date: TODAY, time: "20:30" })).toBe(0);
      expect(hasReminder(db, shift.id, "evening_before")).toBe(false); // still owed
      expect(listRecentAudit(db, 10)).toEqual([]);

      const { bot, sent } = testBot();
      expect(await runReminderTick(db, bot, { date: TODAY, time: "20:35" })).toBe(1);
      expect(sent).toHaveLength(1);
    } finally {
      errorLog.mockRestore();
    }
  });

  it("does not remind for a shift happening today (only tomorrow)", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TODAY, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("пишет одну строку на прогон, когда напоминания ушли", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    const mark = linkedEmployee(db, "Марк", 112);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: mark.id });

    const { bot } = testBot();
    expect(await runReminderTick(db, bot, { date: TODAY, time: "20:05" })).toBe(2);

    const rows = listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ forDate: TOMORROW, sent: 2 });
    expect(rows[0]!.actorEmployeeId).toBeNull();
  });

  it("молчит, когда отправлять было нечего", async () => {
    const db = makeTestDb();
    const { bot } = testBot();
    await runReminderTick(db, bot, { date: TODAY, time: "20:05" });
    expect(listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched")).toEqual([]);
  });

  it("на повторном тике в тот же вечер второй строки не появляется", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    const { bot } = testBot();
    await runReminderTick(db, bot, { date: TODAY, time: "20:05" });
    // `hasReminder` дедуплицирует отправку, так что второй тик шлёт ноль — и молчит.
    await runReminderTick(db, bot, { date: TODAY, time: "20:10" });

    expect(listRecentAudit(db, 20).filter((row) => row.type === "reminders_dispatched")).toHaveLength(1);
  });
});

describe("who a reminder is addressed to", () => {
  it("greets by the Telegram name, not by the roster's first word", async () => {
    // The roster is «Фамилия Имя», so splitting displayName addressed people by
    // surname alone: «Привет, Петров». See addressOf in @planer/shared.
    const db = makeTestDb();
    const employee = createEmployee(db, { displayName: "Петров Алексей", inviteToken: "i-1" });
    linkTelegramAccount(db, "i-1", 777, "andrey", "Андрей");
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: employee.id });
    const { bot, sent } = testBot();

    await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(sent[0]!.text).toContain("Привет, Андрей!");
    expect(sent[0]!.text).not.toContain("Петров");
  });

  it("uses the full name when Telegram gave us none — formal beats rude", async () => {
    const db = makeTestDb();
    const employee = createEmployee(db, { displayName: "Петров Алексей", inviteToken: "i-2" });
    linkTelegramAccount(db, "i-2", 778);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: employee.id });
    const { bot, sent } = testBot();

    await runReminderTick(db, bot, { date: TODAY, time: "20:30" });
    expect(sent[0]!.text).toContain("Привет, Петров Алексей!");
  });

  it("carries the button that turns these off", async () => {
    // The moment somebody wants reminders to stop is the moment one is in front
    // of them — the switch has to be reachable from the message itself.
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 779);
    createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: anya.id });

    const bot = new Bot("12345:tok");
    bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
      can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
    const payloads: Record<string, unknown>[] = [];
    bot.api.config.use((_prev, method, payload) => {
      if (method === "sendMessage") payloads.push(payload as Record<string, unknown>);
      return { ok: true, result: {} } as never;
    });

    await runReminderTick(db, bot, { date: TODAY, time: "20:30" });
    expect(JSON.stringify(payloads[0]!.reply_markup)).toContain("reminders:off");
  });
});

describe("which shifts get a reminder at all", () => {
  const cases = [
    { label: "утренняя", start: "08:00", end: "17:00", expected: 1 },
    { label: "вечерняя", start: "11:00", end: "20:00", expected: 1 },
    { label: "ночная", start: "15:00", end: "23:00", expected: 1 },
    // The default 09:00–18:00 stays silent on purpose — see isReminderWorthy.
    { label: "обычная дневная", start: "09:00", end: "18:00", expected: 0 },
  ];

  for (const { label, start, end, expected } of cases) {
    it(`${label} ${start}–${end} → ${expected === 1 ? "напоминает" : "молчит"}`, async () => {
      const db = makeTestDb();
      const anya = linkedEmployee(db, "Аня", 800 + start.length + end.length + label.length);
      createShift(db, { date: TOMORROW, start, end, employeeId: anya.id });
      const { bot, sent } = testBot();

      expect(await runReminderTick(db, bot, { date: TODAY, time: "20:30" })).toBe(expected);
      expect(sent).toHaveLength(expected);
    });
  }

  it("says which kind of shift it is, so the message is worth reading", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 860);
    createShift(db, { date: TOMORROW, start: "11:00", end: "20:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    await runReminderTick(db, bot, { date: TODAY, time: "20:30" });
    expect(sent[0]!.text).toContain("вечерняя");
    expect(sent[0]!.text).toContain("11:00–20:00");
  });

  it("still says nothing to somebody who switched reminders off", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 861);
    db.update(employees).set({ remindersEnabled: false }).where(eq(employees.id, anya.id)).run();
    createShift(db, { date: TOMORROW, start: "11:00", end: "20:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    expect(await runReminderTick(db, bot, { date: TODAY, time: "20:30" })).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe("one bad shift does not end the evening", () => {
  // The tick reads tomorrow's shifts once, then awaits Telegram for each in turn.
  // An admin deleting a shift during that gap made the write-down of «reminder
  // sent» hit a dead foreign key — which threw out of the loop, so everybody
  // further down the list got nothing that evening, and nothing said so.
  it("keeps going when a shift is deleted while its reminder is in flight", async () => {
    const db = makeTestDb();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const first = linkedEmployee(db, "Первый Работник", 701);
      const second = linkedEmployee(db, "Второй Работник", 702);
      const doomed = createShift(db, { date: TOMORROW, start: "08:00", end: "17:00", employeeId: first.id });
      createShift(db, { date: TOMORROW, start: "08:30", end: "17:30", employeeId: second.id });

      const bot = new Bot("12345:tok");
      bot.botInfo = { id: 42, is_bot: true, first_name: "P", username: "p_bot",
        can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false } as unknown as typeof bot.botInfo;
      const sent: { chat_id: number | string }[] = [];
      bot.api.config.use((_prev, method, payload) => {
        if (method === "sendMessage") {
          const p = payload as { chat_id: number };
          sent.push(p);
          // The admin removes tomorrow's shift right as its reminder goes out.
          if (p.chat_id === 701) deleteShift(db, doomed.id);
        }
        return { ok: true, result: {} } as any;
      });

      await expect(runReminderTick(db, bot, { date: TODAY, time: "20:05" })).resolves.toBeTypeOf("number");
      expect(sent.map((s) => s.chat_id)).toContain(702);
    } finally {
      errorLog.mockRestore();
    }
  });
});
