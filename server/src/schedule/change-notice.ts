import { addressOf, categoryAccusative, categoryPossessive } from "@planer/shared";
import type { Bot } from "grammy";

import { notifyUser } from "../bot/notify";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { getEmployeeById } from "../repo/employees";
import { listShiftsOverlapping } from "../repo/shifts";
import { entryLineOf } from "../util/message-lines";
import { dayAfterLine } from "./day-summary";
import { diffSchedules, type EmployeeDiff } from "./schedule-diff";

/** Just enough of an entry to write a line about it. */
type EntryLike = Parameters<typeof entryLineOf>[0];

/**
 * Род автора правки неизвестен: у работника есть имя, но не пол, и заводить
 * ради писем колонку «пол» — цена выше пользы. Форма `поставил(а)` уже принята
 * в этом боте (`отдал(а)`, `отказался(лась)` в `bot/notify.ts`), поэтому письма
 * про график говорят так же, а не «Антон поставила тебе смену».
 *
 * The word for the entry itself comes from its category. Until 2026-08-11 all
 * three texts said «смену» regardless of what was edited.
 */
export function entryAddedText(actorName: string, entry: EntryLike): string {
  return `${actorName} поставил(а) тебе ${categoryAccusative(entry.category)}: ${entryLineOf(entry)}.`;
}

export function entryRemovedText(actorName: string, entry: EntryLike): string {
  return `${actorName} снял(а) с тебя ${categoryAccusative(entry.category)}: ${entryLineOf(entry)}.`;
}

/**
 * Называет и «было», и «стало»: человеку важно, что именно у него поменялось.
 *
 * A changed category is said outright — «заменил(а) твой отпуск на смену» —
 * because «изменил(а) твой отпуск … стало День» stays unreadable even with the
 * right noun. That exact sentence is what a worker read about his own cancelled
 * holiday on 2026-08-07, and what made him ask what was going on.
 */
export function entryChangedText(actorName: string, before: EntryLike, after: EntryLike): string {
  const verb =
    before.category === after.category
      ? `изменил(а) ${categoryPossessive(before.category)}`
      : `заменил(а) ${categoryPossessive(before.category)} на ${categoryAccusative(after.category)}`;
  return `${actorName} ${verb}: было ${entryLineOf(before)} → стало ${entryLineOf(after)}.`;
}

/** До скольких из скольких дошло: `intended` считает и тех, у кого нет телеграма. */
export interface NotifyReach {
  delivered: number;
  intended: number;
}

/** Запись целиком в прошлом: даже её последний день раньше сегодняшнего. */
function isPast(s: Shift, today: string): boolean {
  return (s.endDate ?? s.date) < today;
}

/**
 * Тот же диф, но без событий, которые уже никого не будят.
 *
 * Перенос ИЗ прошлого в будущее остаётся — это про будущее, о нём сказать надо;
 * молчит только правка, целиком лежащая в прошлом. Общая функция для
 * `notifyScheduleChange` и предсказания в `notice-buffer`: правило одно, и ему
 * не дано разойтись между тем, что уходит, и тем, что обещано в ответе роута.
 */
export function filterFutureDiff(diff: EmployeeDiff, today: string): EmployeeDiff {
  return {
    added: diff.added.filter((s) => !isPast(s, today)),
    removed: diff.removed.filter((s) => !isPast(s, today)),
    changed: diff.changed.filter((c) => !(isPast(c.before, today) && isPast(c.after, today))),
  };
}

export type ChangeCause = "file" | "distribute" | "fill_week" | "manual";

const CAUSE_LABEL: Record<ChangeCause, string | null> = {
  file: "загрузка файла",
  distribute: "распределение смен",
  fill_week: "заполнение недели",
  // A hand edit needs no explanation — «обновил(а) твой график (ручная правка)»
  // states the obvious. The other three name a machine that did the work.
  manual: null,
};

const MAX_LINES = 10;

/**
 * Одно письмо на человека вместо письма на запись.
 *
 * Импорт августа — это 538 записей; поштучно это лавина в чат и гарантированный
 * 429 от Telegram. Одна запись сводкой не оформляется — там нечего сводить, и
 * обычный одиночный текст точнее.
 */
export function scheduleSummaryText(actorName: string, cause: ChangeCause, diff: EmployeeDiff): string {
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  if (total === 1) {
    if (diff.added[0]) return entryAddedText(actorName, diff.added[0]);
    if (diff.removed[0]) return entryRemovedText(actorName, diff.removed[0]);
    const c = diff.changed[0]!;
    return entryChangedText(actorName, c.before, c.after);
  }

  const counts: string[] = [];
  if (diff.added.length) counts.push(`+${diff.added.length} ${plural(diff.added.length, "смена", "смены", "смен")}`);
  if (diff.removed.length) counts.push(`−${diff.removed.length}`);
  if (diff.changed.length) counts.push(`изменено ${diff.changed.length}`);

  const lines = [
    ...diff.added.map((s) => `+ ${entryLineOf(s)}`),
    ...diff.removed.map((s) => `− ${entryLineOf(s)}`),
    ...diff.changed.map((c) => `→ ${entryLineOf(c.before)} → ${entryLineOf(c.after)}`),
  ];
  const shown = lines.slice(0, MAX_LINES).map((l) => `\n• ${l}`).join("");
  const rest = lines.length > MAX_LINES ? `\n…и ещё ${lines.length - MAX_LINES}` : "";
  const why = CAUSE_LABEL[cause] ? ` (${CAUSE_LABEL[cause]})` : "";
  return `${actorName} обновил(а) твой график${why}: ${counts.join(", ")}.${shown}${rest}`;
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return many;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}

/**
 * Appends «what you have on that day now» when it says something new.
 *
 * Only for the one-entry letter: a summary of several changes already lists
 * them, and the same line under it would repeat itself. A multi-day entry is
 * summarised by its first day — the same day `entryLineOf` leads with.
 *
 * Lives on `notifyScheduleChange` rather than on the per-entry path because the
 * hand edits go through the notice buffer, and the buffer sends from here.
 */
function withDayAfter(db: Db, diff: EmployeeDiff, text: string): string {
  const total = diff.added.length + diff.removed.length + diff.changed.length;
  const only = diff.added[0] ?? diff.removed[0] ?? diff.changed[0]?.after;
  if (total !== 1 || !only || only.employeeId == null) return text;

  const line = dayAfterLine(db, {
    employeeId: only.employeeId,
    date: only.date,
    // For a deleted entry this id is already gone from the table, so the
    // "only the named one" branch cannot fire and the worker gets the honest
    // remainder of the day.
    keepSilentForEntryId: only.id,
  });
  return line ? `${text}\n${line}` : text;
}

interface ScheduleChangeOpts {
  actorEmployeeId: number;
  diffs: Map<number, EmployeeDiff>;
  cause: ChangeCause;
  now: { date: string; time: string };
}

/**
 * Одно сводное письмо на человека для массовой правки: импорта, «Распределить
 * честно», «Заполнить неделю». Тот же фильтр «прошлое молчит» и то же правило
 * «себе не пишем», что в `notifyEntryChange`, но вместо отдельного текста на
 * каждое событие — один `scheduleSummaryText` на всё, что у человека изменилось.
 */
export async function notifyScheduleChange(
  db: Db,
  bot: Bot | undefined,
  opts: ScheduleChangeOpts,
): Promise<NotifyReach> {
  if (!bot) return { delivered: 0, intended: 0 };

  const actor = getEmployeeById(db, opts.actorEmployeeId);
  const actorName = actor ? addressOf(actor) : "Админ";
  let delivered = 0;
  let intended = 0;

  for (const [employeeId, d] of opts.diffs) {
    if (employeeId === opts.actorEmployeeId) continue; // себе не пишем
    const future = filterFutureDiff(d, opts.now.date);
    const total = future.added.length + future.removed.length + future.changed.length;
    if (total === 0) continue;

    intended += 1;
    const target = getEmployeeById(db, employeeId);
    if (target?.telegramUserId == null) continue;
    const text = withDayAfter(db, future, scheduleSummaryText(actorName, opts.cause, future));
    if (await notifyUser(bot, target.telegramUserId, text)) delivered += 1;
  }
  return { delivered, intended };
}

/**
 * Снимок расписания диапазона до и после операции.
 *
 * Считаем изменение по базе, а не по отчёту сервиса о самом себе: одна механика
 * на импорт, распределение и заполнение недели, и она не может разойтись с тем,
 * что реально легло в базу. `listShiftsOverlapping`, а не диапазонный запрос по
 * `date` — иначе многодневное отсутствие, начавшееся до `from`, в снимке
 * отсутствует и его удаление выглядит как «ничего не менялось».
 */
export function withScheduleDiff<T>(
  db: Db,
  range: { from: string; to: string },
  work: () => T,
): { result: T; diffs: Map<number, EmployeeDiff> } {
  const before = listShiftsOverlapping(db, range.from, range.to);
  const result = work();
  const after = listShiftsOverlapping(db, range.from, range.to);
  return { result, diffs: diffSchedules(before, after) };
}
