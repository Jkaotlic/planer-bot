import type { Bot } from "grammy";
import { nextDate, isReminderWorthy, reminderKind, wakeTime, buildReminderText } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsInRange } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";
import { hasReminder, addReminder } from "../repo/reminders";
import { notifyUser } from "../bot/notify";

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
      name: owner.displayName,
      kind,
      timeRange: `${start}–${end}`,
      wake: kind === "morning" ? wakeTime(start, owner.prepBufferMin) : undefined,
    });

    await notifyUser(bot, owner.telegramUserId, text);
    addReminder(db, shift.id, REMINDER_KIND);
    count++;
  }
  return count;
}
