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
 * Запись, уже завершившаяся до `today` (`coalesce(endDate, date) < today`),
 * сюда не попадает вовсе — тот же критерий, которым сервер строит окно
 * (Task 1: `coalesce(endDate, date) >= from`), так что этот список никогда не
 * "видит" то, что сервер уже отфильтровал бы сам.
 *
 * Запись, которая уже идёт (началась раньше `today`, но ещё не кончилась —
 * например, длинный отпуск), живёт в ТЕКУЩЕЙ неделе: там, где её застаёт
 * `today`, а не в неделе своего начала — та уже прошла целиком. В неделе
 * своего начала лежит только запись, которая ещё не началась. В обоих
 * случаях — ровно одна неделя: отпуск через её границу не должен появиться
 * дважды и посчитаться дважды.
 *
 * Пустых недель между занятыми не бывает: секция существует, только если в неё
 * что-то попало.
 */
export function groupUpcomingByWeek(shifts: readonly Shift[], today: string): UpcomingWeek[] {
  const thisMonday = mondayOfIso(today);
  const nextMonday = addDaysIso(thisMonday, 7);
  const spanEnd = (s: Shift) => s.endDate ?? s.date;

  const byMonday = new Map<string, Shift[]>();
  for (const shift of [...shifts].sort((a, b) => a.date.localeCompare(b.date))) {
    if (spanEnd(shift) < today) continue; // уже кончилась — ей здесь не место
    const bucketDate = shift.date > today ? shift.date : today; // идущая сейчас запись живёт в текущей неделе
    const monday = mondayOfIso(bucketDate);
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
