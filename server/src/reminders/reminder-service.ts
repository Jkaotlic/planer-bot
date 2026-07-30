import type { Bot } from "grammy";
import { nextDate, isReminderWorthy, reminderKind, wakeTime, buildReminderText, addressOf } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsInRange } from "../repo/shifts";
import { getEmployeeById } from "../repo/employees";
import { hasReminder, addReminder } from "../repo/reminders";
import { recordAudit } from "../repo/audit";
import { notifyReminder } from "../bot/notify";
import { safeErrorMessage } from "../util/safe-error";
import type { Shift } from "../db/schema";

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
    try {
      count += await remindFor(db, bot, shift);
    } catch (err) {
      // The list of shifts was read once, up front, and each send below awaits
      // Telegram — an admin deleting tomorrow's shift in that gap leaves the
      // «reminder sent» write pointing at a row that no longer exists. That used
      // to throw out of this loop, so everybody further down the list got nothing
      // that evening and nothing said why. One person's shift going wrong is not
      // a reason for the other twenty to stay unreminded.
      console.error(`runReminderTick: shift ${shift.id} skipped:`, safeErrorMessage(err));
    }
  }
  return count;
}

/** One shift's reminder. Returns 1 if it went out, 0 otherwise. */
async function remindFor(db: Db, bot: Bot, shift: Shift): Promise<number> {
    if (hasReminder(db, shift.id, REMINDER_KIND)) return 0;
    const owner = getEmployeeById(db, shift.employeeId!);
    if (!owner || !owner.remindersEnabled || owner.telegramUserId == null) return 0;

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
      return 1;
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
    return 0;
}
