import { isIdenticalShift, isSwappable } from "@planer/shared";
import type { Shift } from "../api/client";
import { hasStarted } from "./swaps";

export interface SwapCandidates {
  /** С кем обмен реально пройдёт — те же условия, что проверяет сервер. */
  candidates: Shift[];
  /** Сколько человек в этот день работают ровно твою смену. */
  sameKindCount: number;
}

/**
 * Кого показать на экране обмена.
 *
 * Меняться можно только внутри одного дня, поэтому день задан отдаваемой сменой,
 * а вопрос сводится к «кто ещё в этот день работает и с кем обмен что-то изменит».
 *
 * Тех, у кого в этот день ровно такая же смена, экран прячет — сервер всё равно
 * ответит `identical-shift`, — но их надо посчитать: человек ищет коллегу,
 * которого точно видел в графике на этот день, и молчаливое отсутствие читается
 * как «экран сломан».
 *
 * Сортировка по имени, а не по времени: на этом экране выбирают человека.
 */
export function swapCandidates(
  fromShift: Shift,
  dayShifts: readonly Shift[],
  meId: number,
  now: Date,
  /** Кого админ вывел из обменов. Отдельным множеством, а не полем на смене:
   *  запрет висит на человеке, а не на конкретной записи графика. */
  excludedIds: ReadonlySet<number>,
): SwapCandidates {
  const candidates: Shift[] = [];
  let sameKindCount = 0;

  for (const shift of dayShifts) {
    if (shift.date !== fromShift.date) continue;
    if (shift.employeeId == null || shift.employeeId === meId) continue;
    // Правило живёт в shared: экран, который прячет кандидата там, где сервер
    // обмен принимает, — наблюдаемый дефект. Своей копии здесь больше нет.
    if (!isSwappable(shift.category)) continue;
    if (shift.start == null || shift.end == null) continue;
    if (hasStarted(shift, now)) continue;
    // Раньше проверки «такая же смена»: исключённого не прячут как одинакового,
    // с ним нельзя меняться вообще, и в sameKindCount он попасть не должен.
    if (excludedIds.has(shift.employeeId)) continue;
    if (isIdenticalShift(fromShift, shift)) {
      sameKindCount += 1;
      continue;
    }
    candidates.push(shift);
  }

  candidates.sort((a, b) => (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "ru"));
  return { candidates, sameKindCount };
}
