import { countsForBalance, isAbsence, type EntryCategory } from "./category";

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

/** Запись, по которой можно судить, кто в какой день есть. */
export interface PresenceEntry {
  employeeId: number | null;
  category: EntryCategory;
  date: string;
  endDate?: string | null;
}

/**
 * Кого в этот день нет — множеством, один проход по записям.
 *
 * Отдельно от `isAbsentOn`, потому что расчёт покрытия спрашивает про каждого
 * человека каждого вида смены каждого дня недели, и поиск по всем записям на
 * каждый вопрос стал бы квадратом от размера недели — на экране, который
 * пересчитывает это на каждый рендер.
 */
export function absentPeopleOn(entries: readonly PresenceEntry[], date: string): Set<number> {
  const absent = new Set<number>();
  for (const e of entries) {
    if (e.employeeId != null && isAbsence(e.category) && e.date <= date && date <= (e.endDate ?? e.date)) absent.add(e.employeeId);
  }
  return absent;
}

/**
 * Рабочая запись на человеке, которого в этот день нет: смена «ждёт замены».
 *
 * Одно правило на всех, кто считает покрытие (нехватка, совет, бейдж) и кто
 * подсвечивает клетку: экран, где смена больного выглядит закрытой, а бейдж
 * считает её дырой, — это два ответа на один вопрос. Смена стоит на больном до
 * решения по передаче (`handover-service`), поэтому сама по себе запись ещё не
 * значит, что кто-то выйдет.
 */
export function waitsForCover(entry: PresenceEntry, entries: readonly PresenceEntry[], date: string): boolean {
  if (entry.employeeId == null || !countsForBalance(entry.category)) return false;
  if (entry.date > date || (entry.endDate ?? entry.date) < date) return false;
  return absentPeopleOn(entries, date).has(entry.employeeId);
}
