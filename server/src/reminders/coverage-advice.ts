import type { Bot } from "grammy";
import { addDaysIso, coverageAdviceText, eachDayIso, parseCoverage, scheduleGaps } from "@planer/shared";
import type { Db } from "../db/client";
import { listShiftsOverlapping } from "../repo/shifts";
import { listActiveTemplates } from "../repo/templates";
import { acknowledgedCoverageDates, coverageAdviceSentOn, markCoverageAdviceSent, reminderHour, restoreCoverageAdviceSent } from "../repo/settings";
import { loadCalendar } from "../repo/calendar-days";
import { recordAudit } from "../repo/audit";
import { notifyAdmins, reachedNobody, scheduleLink, type AdminAction } from "../bot/notify";

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
 * Праздник в пробел не попадает — тик читает `loadCalendar` и не считает
 * праздничный день дырой; для рабочей субботы, оставленной без смен, это
 * обычная дыра, и текст про неё как раз и предупреждает. Выключается как
 * любой вид админских уведомлений.
 *
 * Час — тот же, что у вечерних напоминаний о смене: админ настраивает одно
 * «когда бот пишет вечером», а не два.
 *
 * Возвращает 1, если письмо ушло, иначе 0.
 */
export async function runCoverageAdviceTick(
  db: Db,
  bot: Bot,
  now: { date: string; time: string },
  publicUrl?: string,
): Promise<number> {
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
  // Праздник не пуст: в него не выходят. Рабочая суббота, наоборот, обычный
  // день, и оставленная без смен она — тот самый пробел.
  const allGaps = scheduleGaps(entries, templates, eachDayIso(from, to), loadCalendar(db, from, to));
  // Даты, про которые админ нажал «Знаю про этот день», в совет не попадают.
  const acked = acknowledgedCoverageDates(db, [...new Set(allGaps.map((g) => g.date))]);
  const gaps = allGaps.filter((g) => !acked.has(g.date));
  const text = coverageAdviceText(gaps);

  // Отметка ставится и когда сказать нечего: иначе тик пересчитывал бы неделю
  // каждые пять минут весь вечер ради того же молчания.
  const previous = coverageAdviceSentOn(db);
  markCoverageAdviceSent(db, now.date);
  if (!text) return 0;

  // Кнопка ведёт на первый день с пробелом — открывать всю неделю ради него
  // незачем: `gaps` уже упорядочен по датам (`eachDayIso` идёт по возрастанию).
  const open: AdminAction[] = publicUrl ? [{ text: "📅 Открыть график", webApp: scheduleLink(publicUrl, gaps[0]!.date) }] : [];
  // «Знаю про дд.мм» — на каждую дату, не больше пяти: длиннее клавиатура
  // закрывает само письмо на экране телефона.
  const acks: AdminAction[] = [...new Set(gaps.map((g) => g.date))].slice(0, 5).map((date) => ({
    text: `✓ Знаю про ${date.slice(8, 10)}.${date.slice(5, 7)}`,
    data: `coverage:ack:${date}`,
  }));
  const reach = await notifyAdmins(bot, db, "coverage", text, [...open, ...acks]);
  // Не дошло ни до кого — обрыв сети, а не решение админов: вернуть прежнюю
  // отметку, и следующий тик того же вечера попробует снова.
  if (reachedNobody(reach)) {
    restoreCoverageAdviceSent(db, previous);
    return 0;
  }
  recordAudit(db, "coverage_advice_sent", null, { from, to, days: gaps.length });
  return 1;
}
