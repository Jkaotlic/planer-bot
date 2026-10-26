import type { Bot } from "grammy";
import { addDaysIso, shiftStartMs } from "@planer/shared";
import type { Db } from "../db/client";
import { listUnansweredAssignments } from "../repo/weekend";
import { getEmployeeById } from "../repo/employees";
import { getShift } from "../repo/shifts";
import { hasReminder, addReminder } from "../repo/reminders";
import { notifyAdmins, scheduleLink } from "../bot/notify";
import { slotLineOf } from "../util/message-lines";
import { safeErrorMessage } from "../util/safe-error";

/** За сколько дней до слота молчание становится поводом сказать админам. */
export const WEEKEND_NUDGE_DAYS = 2;

const NUDGE_KIND = "weekend_unanswered";

/**
 * Назначение на выходной, на которое человек не ответил, — админам за два дня.
 *
 * Запись в графике появляется сразу при назначении, а «выйду / не смогу» лишь
 * подтверждает её. Не ответивший выглядел в графике вышедшим, и узнавали об
 * этом в субботу утром. Два дня — чтобы у админа остались сутки найти замену
 * (его решение от 2026-09-28).
 *
 * Один раз на назначение: пометка в `reminder_log` на его запись в графике. Не
 * дошло ни до кого из-за сети — пометку не ставим, следующий тик повторит.
 * Назначение без записи (её удалили) пропускается: говорить не о чем.
 *
 * Кроме окна в два дня — половина срока между предложением и началом слота
 * (H3, его решение от 2026-10-26). Без неё назначенный за сутки получал
 * «не ответил(а)» через пять минут, когда ответить он ещё и не успел. Момент
 * предложения — `createdAt` записи в графике: повторное предложение после отказа
 * пишет новую запись (`assignSlot`), так что отсчёт начинается заново сам. `at` —
 * абсолютное «сейчас»: `createdAt` хранится моментом UTC, и сравнивать его с
 * командными часами `now` было бы ошибкой на величину пояса.
 */
export async function runWeekendNudgeTick(
  db: Db, bot: Bot, now: { date: string; time: string }, publicUrl: string,
  teamTz: string, at: Date = new Date(),
): Promise<number> {
  let sent = 0;
  const until = addDaysIso(now.date, WEEKEND_NUDGE_DAYS);
  for (const { assignment, slot } of listUnansweredAssignments(db, now.date, until)) {
    try {
      if (assignment.shiftId == null || hasReminder(db, assignment.shiftId, NUDGE_KIND)) continue;
      const entry = getShift(db, assignment.shiftId);
      if (!entry) continue;
      // Начало слота — в поясе команды: «10:00» в слоте — это 10:00 у людей, а не UTC.
      const startsMs = shiftStartMs(slot, teamTz);
      const offeredMs = entry.createdAt.getTime();
      if (at.getTime() < offeredMs + (startsMs - offeredMs) / 2) continue;
      const name = getEmployeeById(db, assignment.employeeId)?.displayName ?? "Работник";
      const reach = await notifyAdmins(
        bot, db, "weekend",
        `⏳ ${name} не ответил(а) на выход в выходной — ${slotLineOf(slot)}. Запись в графике стоит, но подтверждения нет.`,
        { text: "📅 Открыть график", webApp: scheduleLink(publicUrl, slot.date) },
      );
      if (reach.attempted > 0 && reach.delivered === 0) continue;
      addReminder(db, assignment.shiftId, NUDGE_KIND);
      sent += reach.delivered;
    } catch (err) {
      console.error(`runWeekendNudgeTick: assignment ${assignment.id} skipped:`, safeErrorMessage(err));
    }
  }
  return sent;
}
