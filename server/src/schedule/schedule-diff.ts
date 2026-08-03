import type { Shift } from "../db/schema";

export interface EmployeeDiff {
  added: Shift[];
  removed: Shift[];
  changed: { before: Shift; after: Shift }[];
}

/**
 * Поля, ради которых человека вообще стоит будить.
 *
 * Заметка, подпись, пресет и локация сюда не входят: они меняют, как запись
 * выглядит, а не что человеку делать. Список закрыт намеренно — «уведомлять обо
 * всём подряд» кончается тем, что уведомления перестают читать.
 */
const SIGNIFICANT = ["employeeId", "date", "endDate", "start", "end", "category"] as const;

function differs(a: Shift, b: Shift): boolean {
  return SIGNIFICANT.some((field) => a[field] !== b[field]);
}

/**
 * Что изменилось в расписании, по людям.
 *
 * Сравнение идёт по `id`, поэтому запись, сменившая владельца, видна как снятие
 * у прежнего и постановка новому — для двух этих людей это два совершенно
 * разных факта, и одним «изменено» их не описать.
 *
 * Записи без сотрудника (вакантные) не принадлежат никому и в диф не попадают:
 * ничья строка по замыслу, писать о ней некому.
 */
export function diffSchedules(before: readonly Shift[], after: readonly Shift[]): Map<number, EmployeeDiff> {
  const result = new Map<number, EmployeeDiff>();
  const bucket = (employeeId: number): EmployeeDiff => {
    let diff = result.get(employeeId);
    if (!diff) {
      diff = { added: [], removed: [], changed: [] };
      result.set(employeeId, diff);
    }
    return diff;
  };

  const beforeById = new Map(before.map((s) => [s.id, s]));
  const afterById = new Map(after.map((s) => [s.id, s]));

  for (const now of after) {
    const was = beforeById.get(now.id);
    if (!was) {
      if (now.employeeId != null) bucket(now.employeeId).added.push(now);
      continue;
    }
    if (!differs(was, now)) continue;
    if (was.employeeId !== now.employeeId) {
      if (was.employeeId != null) bucket(was.employeeId).removed.push(was);
      if (now.employeeId != null) bucket(now.employeeId).added.push(now);
      continue;
    }
    if (now.employeeId != null) bucket(now.employeeId).changed.push({ before: was, after: now });
  }

  for (const was of before) {
    if (afterById.has(was.id)) continue;
    if (was.employeeId != null) bucket(was.employeeId).removed.push(was);
  }

  return result;
}
