import { isAbsence, type EntryCategory } from "./category";

/**
 * Человек в этот день отсутствует: среди записей есть его отпуск, больничный
 * или командировка, покрывающие дату.
 *
 * Нужна тем, кто пишет человеку про его смену: смена, которую больной отдаёт,
 * до решения остаётся на нём, и без этой проверки он получал «Завтра смена» и
 * чек-лист, а коллеги видели его в «Завтра с тобой». Записи передаются, а не
 * читаются здесь: вызывающий уже держит записи дня в руках.
 */
export function isAbsentOn(
  entries: readonly { employeeId: number | null; category: EntryCategory; date: string; endDate: string | null }[],
  employeeId: number,
  date: string,
): boolean {
  return entries.some(
    (e) => e.employeeId === employeeId && isAbsence(e.category) && e.date <= date && date <= (e.endDate ?? e.date),
  );
}
