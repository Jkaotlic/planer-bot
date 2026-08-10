import type { Db } from "../db/client";
import { getShift } from "../repo/shifts";
import { getTemplate } from "../repo/templates";
import { getTemplateRoles } from "../repo/template-roles";
import { getEmployeeById } from "../repo/employees";

/**
 * «Дежурство уходит человеку вне своего пула» — факт, из которого делают фразу
 * (`dutyNoticeForReceiver` / `dutyNoticeForAdmins` в `bot/notify.ts`).
 *
 * Факт, а не готовая строка: одна правда звучит по-разному тому, кто берёт
 * дежурство, и админам, читающим про третьего человека. Две фразы из одного
 * факта — не два источника правды; две функции, каждая со своим запросом к
 * базе, были бы им.
 */
export interface OutsidePoolFact {
  /** Как называется дежурство — имя пресета: «Дежурство · Поклонка». */
  dutyName: string;
  /** Кто его получает. */
  receiverName: string;
}

/**
 * Никогда не запрет — только повод сказать словами.
 *
 * Пул дежурства остаётся правилом автораздачи: работники вправе договориться
 * между собой (его решение от 2026-08-10). Пустой пул — «можно всем», это
 * правило `template_pool`, а не недонастроенный пресет, поэтому молчим.
 */
export function outsidePoolFact(
  db: Db,
  input: { shiftId: number | null; receiverId: number },
): OutsidePoolFact | null {
  const shift = input.shiftId == null ? undefined : getShift(db, input.shiftId);
  if (!shift || shift.category !== "duty" || shift.templateId == null) return null;

  const { pool } = getTemplateRoles(db, shift.templateId);
  if (pool.length === 0 || pool.includes(input.receiverId)) return null;

  const receiver = getEmployeeById(db, input.receiverId);
  if (!receiver) return null;
  return {
    dutyName: getTemplate(db, shift.templateId)?.name ?? shift.title ?? "дежурство",
    receiverName: receiver.displayName,
  };
}

/**
 * Обе стороны разом: вторая сторона получает `fromShift`, инициатор — `toShift`.
 *
 * Порядок — «сначала то, что уходит от инициатора»: так же читается и сама
 * заявка. Смотрит на переданные id, а не на владельцев записей, поэтому
 * одинаково верна и до обмена, и после того, как записи поменяли хозяев.
 */
export function outsidePoolFacts(
  db: Db,
  request: { fromEmployeeId: number; toEmployeeId: number; fromShiftId: number | null; toShiftId: number | null },
): OutsidePoolFact[] {
  return [
    outsidePoolFact(db, { shiftId: request.fromShiftId, receiverId: request.toEmployeeId }),
    outsidePoolFact(db, { shiftId: request.toShiftId, receiverId: request.fromEmployeeId }),
  ].filter((fact): fact is OutsidePoolFact => fact !== null);
}
