import { addDaysIso, formatWeekRangeLabelIso, mondayOfIso } from "@planer/shared";
import type { Shift } from "../api/client";
import { durationHours } from "./shift";

export interface UpcomingWeek {
  /** Понедельник недели, "YYYY-MM-DD" — стабильный React-ключ. */
  key: string;
  /** «Эта неделя · 5–9 августа» / «Следующая неделя · 10–16 августа» / «24–30 августа» */
  label: string;
  shifts: Shift[];
}

/**
 * Режет список будущих записей на недельные секции.
 *
 * Диапазон текущей недели начинается с `today`, а не с понедельника: прошедших
 * дней в секции нет, и заголовок не должен обещать того, чего в ней не лежит.
 *
 * Многодневная запись живёт в неделе своего начала и только там — отпуск через
 * границу недели не должен появиться дважды и посчитаться дважды.
 *
 * Пустых недель между занятыми не бывает: секция существует, только если в неё
 * что-то попало.
 */
export function groupUpcomingByWeek(shifts: readonly Shift[], today: string): UpcomingWeek[] {
  const thisMonday = mondayOfIso(today);
  const nextMonday = addDaysIso(thisMonday, 7);

  const byMonday = new Map<string, Shift[]>();
  for (const shift of [...shifts].sort((a, b) => a.date.localeCompare(b.date))) {
    const monday = mondayOfIso(shift.date);
    const bucket = byMonday.get(monday);
    if (bucket) bucket.push(shift);
    else byMonday.set(monday, [shift]);
  }

  return [...byMonday.keys()]
    .sort()
    .map((monday) => {
      // У текущей недели показываем остаток, а не всю неделю целиком.
      const from = monday === thisMonday ? today : monday;
      const range = formatWeekRangeLabelIso(from, addDaysIso(monday, 6));
      const prefix = monday === thisMonday ? "Эта неделя · " : monday === nextMonday ? "Следующая неделя · " : "";
      return { key: monday, label: `${prefix}${range}`, shifts: byMonday.get(monday)! };
    });
}

/**
 * Сколько рабочих смен и часов осталось до конца текущей недели.
 *
 * Только `category === "shift"`: отпуск — это не смена и не часы, а сводка
 * отвечает на вопрос «сколько мне ещё работать».
 */
export function remainingThisWeek(shifts: readonly Shift[], today: string): { count: number; hours: number } {
  const sunday = addDaysIso(mondayOfIso(today), 6);
  const mine = shifts.filter((s) => s.category === "shift" && s.date >= today && s.date <= sunday);
  return { count: mine.length, hours: mine.reduce((sum, s) => sum + durationHours(s), 0) };
}
