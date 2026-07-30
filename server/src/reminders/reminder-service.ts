import type { Bot } from "grammy";
import { nextDate, isReminderWorthy, reminderKind, wakeTime, buildReminderText, addressOf } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsInRange } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";
import { hasReminder, addReminder } from "../repo/reminders";
import { recordAudit } from "../repo/audit";
import { notifyReminder } from "../bot/notify";

const REMINDER_KIND = "evening_before";
const QUIET_HOUR_CUTOFF = "20:00";

/** Sends soft evening-before reminders for tomorrow's morning/night shifts. Returns the number sent. */
export async function runReminderTick(db: Db, bot: Bot, now: { date: string; time: string }): Promise<number> {
  if (now.time < QUIET_HOUR_CUTOFF) return 0;

  const tomorrow = nextDate(now.date);
  const shifts = listShiftsInRange(db, tomorrow, tomorrow).filter(
    (s) => s.employeeId != null && s.start != null && s.end != null && isReminderWorthy({ start: s.start, end: s.end }),
  );

  let count = 0;
  for (const shift of shifts) {
    if (hasReminder(db, shift.id, REMINDER_KIND)) continue;
    const owner = getEmployeeById(db, shift.employeeId!);
    if (!owner || !owner.remindersEnabled || owner.telegramUserId == null) continue;

    const start = shift.start!;
    const end = shift.end!;
    const kind = reminderKind({ start, end });
    const text = buildReminderText({
      // The name they gave Telegram, not the roster's «Фамилия Имя» — a reminder
      // that opens «Привет, Петров» reads as a roll-call. See `addressOf`.
      name: addressOf(owner),
      kind,
      timeRange: `${start}–${end}`,
      wake: kind === "morning" ? wakeTime(start, owner.prepBufferMin) : undefined,
    });

    const outcome = await notifyReminder(bot, owner.telegramUserId, text);
    if (outcome.ok) {
      addReminder(db, shift.id, REMINDER_KIND);
      count++;
      continue;
    }
    if (outcome.permanent) {
      // A blocked bot or a deleted account refuses every time, and this tick runs
      // every five minutes all evening — so retrying is ~48 hopeless calls a night,
      // forever. Mark it done to stop the loop, and record it: somebody quietly no
      // longer hearing from the bot is a fact an admin needs, and the journal is
      // where this system already tells them things. A busy Telegram (429, 5xx, a
      // dropped connection) is NOT marked and is retried on the next tick, which is
      // the behaviour the test above pins.
      addReminder(db, shift.id, REMINDER_KIND);
      recordAudit(db, "reminder_undeliverable", null, {
        employeeId: owner.id,
        shiftId: shift.id,
        errorCode: outcome.errorCode,
      });
    }
  }
  return count;
}
