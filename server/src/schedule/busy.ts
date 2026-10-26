import { entriesClash, isAbsence, nextDate, prevDate, type BusySpan } from "@planer/shared";
import type { Db } from "../db/client";
import type { Shift } from "../db/schema";
import { listEmployeeShiftsOverlapping } from "../repo/shifts";

/** Интервал, про который спрашивают «свободен ли человек». Форма — как у записи
 *  графика, чтобы саму запись можно было передать без перекладывания полей. */
export type BusyProbe = BusySpan;

/**
 * Первая запись человека, которая стоит поперёк `at`, или `null`, если он свободен.
 *
 * Окно чтения — на сутки шире интервала с обеих сторон, а не дни самой смены:
 * ночь 22:00–08:00 записана на вчерашнюю дату и при выборке «только этот день»
 * не попадала в поле зрения. Так передача предлагала утреннюю смену человеку,
 * который в это утро ещё не ушёл с ночной (H7, аудит 2026-10-26). Больше суток
 * в обе стороны не нужно: запись с часами короче суток.
 *
 * `ignoreEntryId` — сама запись, о которой идёт речь: человек не занят своей же
 * сменой, которую отдаёт или меняет.
 *
 * `ignoreAbsences` — для выходных: там отпуск по решению владельца от 2026-07-30
 * пометка в списке желающих, а не запрет («иногда человек сам просит выйти из
 * отпуска»). Флаг, а не фильтр результата снаружи: первой найденной могла бы
 * оказаться отпускная запись и заслонить настоящую смену в те же часы.
 */
export function busyWith(
  db: Db,
  employeeId: number,
  at: BusyProbe,
  opts: { ignoreEntryId?: number; ignoreAbsences?: boolean } = {},
): Shift | null {
  const around = listEmployeeShiftsOverlapping(db, employeeId, prevDate(at.date), nextDate(at.endDate ?? at.date));
  return (
    around.find(
      (mine) =>
        mine.id !== opts.ignoreEntryId && !(opts.ignoreAbsences && isAbsence(mine.category)) && entriesClash(mine, at),
    ) ?? null
  );
}
