import type { Bot } from "grammy";
import { EMPTY_CALENDAR, addDaysIso, coverageAdviceText, eachDayIso, parseCoverage, scheduleGaps } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsOverlapping } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { coverageAdviceSentOn, markCoverageAdviceSent, reminderHour } from "../repo/settings";
import { recordAudit } from "../repo/audit";
import { notifyAdmins } from "../bot/notify";

/**
 * Насколько вперёд смотрит совет.
 *
 * Неделя, а не завтра: за вечер до смены дыру уже не закрыть, а за неделю —
 * ещё можно. Его выбор от 2026-09-04.
 */
const ADVICE_DAYS = 7;

/**
 * Вечерний совет админам: где на неделе вперёд график пуст или ниже нормы.
 *
 * Именно совет: он не требует действия и не повторяется чаще раза в день.
 * День, оставленный пустым нарочно (праздник, отдел не работает), в письме
 * будет — календаря праздников у бота нет, — и текст сам говорит, что такое
 * можно пропустить. Выключается как любой вид админских уведомлений.
 *
 * Час — тот же, что у вечерних напоминаний о смене: админ настраивает одно
 * «когда бот пишет вечером», а не два.
 *
 * Возвращает 1, если письмо ушло, иначе 0.
 */
export async function runCoverageAdviceTick(db: Db, bot: Bot, now: { date: string; time: string }): Promise<number> {
  if (now.time < reminderHour(db)) return 0;
  if (coverageAdviceSentOn(db) === now.date) return 0;

  const from = addDaysIso(now.date, 1);
  const to = addDaysIso(now.date, ADVICE_DAYS);
  // `listShiftsOverlapping`, а не `listShiftsInRange`: недельное дежурство,
  // начавшееся до окна, закрывает свои дни внутри окна.
  const entries = listShiftsOverlapping(db, from, to);
  const templates = listActiveTemplates(db).map((t) => ({
    templateId: t.id,
    name: t.name,
    coverage: parseCoverage(t.coverage),
  }));
  const gaps = scheduleGaps(entries, templates, eachDayIso(from, to), EMPTY_CALENDAR);
  const text = coverageAdviceText(gaps);

  // Отметка ставится и когда сказать нечего: иначе тик пересчитывал бы неделю
  // каждые пять минут весь вечер ради того же молчания.
  markCoverageAdviceSent(db, now.date);
  if (!text) return 0;

  await notifyAdmins(bot, db, "coverage", text);
  recordAudit(db, "coverage_advice_sent", null, { from, to, days: gaps.length });
  return 1;
}
