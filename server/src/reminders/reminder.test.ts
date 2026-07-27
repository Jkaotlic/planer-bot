import { describe, it, expect, vi } from "vitest";
import { eq } from "drizzle-orm";
import { Bot } from "grammy";
import { makeTestDb } from "../db/testdb";
import { employees } from "../db/schema";
import { createEmployee, linkTelegramAccount } from "../repo/employees";
import { createShift, updateShift } from "../repo/shifts";
import { hasReminder } from "../repo/reminders";
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

  it("does not remind for a day or evening shift (not reminder-worthy)", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TOMORROW, start: "10:00", end: "18:00", employeeId: anya.id }); // day
    createShift(db, { date: TOMORROW, start: "11:00", end: "20:00", employeeId: anya.id }); // evening
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
        "notifyUser: failed for 111:",
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

  it("does not remind for a shift happening today (only tomorrow)", async () => {
    const db = makeTestDb();
    const anya = linkedEmployee(db, "Аня", 111);
    createShift(db, { date: TODAY, start: "08:00", end: "17:00", employeeId: anya.id });
    const { bot, sent } = testBot();

    const count = await runReminderTick(db, bot, { date: TODAY, time: "20:30" });

    expect(count).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
