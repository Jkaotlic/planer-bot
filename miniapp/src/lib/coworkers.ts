import { isAbsence } from "@planer/shared";
import type { Shift } from "../api/client";

/**
 * Кого показать в списке «Кто ещё работает» под тапнутой своей сменой.
 *
 * Себя список не показывает — тап по своей смене спрашивает «кто рядом», не
 * «кто вообще есть в этом дне». Отсутствия (отпуск, больничный, командировка —
 * `isAbsence` из shared, единственный источник этого знания) отсеиваются по
 * той же причине, что и в `swapCandidates`: человек в отпуске не «работает
 * рядом». Запись без времени (нечитаемая клетка импорта) тоже вне списка — час
 * у неё нет, и строка «Имя ·  · Вид» выглядела бы поломкой, а не пустотой.
 *
 * Сортировка по началу смены, затем по имени — так читают расписание дня,
 * а не по алфавиту вперемешку с вечерними сменами.
 */
export function coworkersOf(dayShifts: readonly Shift[], meId: number): Shift[] {
  return dayShifts
    .filter((s) => s.employeeId != null && s.employeeId !== meId)
    .filter((s) => !isAbsence(s.category))
    .filter((s) => s.start != null && s.end != null)
    .slice()
    .sort((a, b) => {
      const byStart = (a.start ?? "").localeCompare(b.start ?? "");
      if (byStart !== 0) return byStart;
      return (a.employeeName ?? "").localeCompare(b.employeeName ?? "", "ru");
    });
}
