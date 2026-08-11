import { categoryLabel } from "@planer/shared";

import type { Db } from "../db/client";
import { listShiftsOverlapping } from "../repo/shifts";
import { dayLabel } from "../util/message-lines";

interface DayAfterOpts {
  employeeId: number;
  date: string;
  /**
   * The entry the letter already named. When it is the only thing left on that
   * day, this line would just repeat the sentence above it.
   */
  keepSilentForEntryId: number;
}

/**
 * «Теперь на Ср 12 авг у тебя: 09:00–18:00 · День, 11:00–20:00 · Вечер.»
 *
 * Существует ради случая, который стоил разбора: админ поставил вторую смену
 * рядом с уже стоявшей и снял первую только через двенадцать часов. Письмо о
 * второй смене говорило лишь про неё, и человек не мог узнать, что у него на
 * этот день теперь две пересекающиеся смены.
 *
 * `listShiftsOverlapping`, а не выборка по `date`: многодневное отсутствие,
 * начавшееся раньше, накрывает этот день и обязано попасть в список.
 *
 * Times are formatted here rather than through `entryLineOf` on purpose — the
 * day is already named once at the front of the line, and repeating it before
 * every entry would read as noise.
 */
export function dayAfterLine(db: Db, opts: DayAfterOpts): string | null {
  const mine = listShiftsOverlapping(db, opts.date, opts.date).filter(
    (entry) => entry.employeeId === opts.employeeId,
  );

  const onlyTheNamedOne = mine.length === 1 && mine[0]!.id === opts.keepSilentForEntryId;
  if (onlyTheNamedOne) return null;

  if (mine.length === 0) return `Теперь на ${dayLabel(opts.date)} у тебя ничего.`;

  const parts = mine
    .map((entry) => {
      // Absences carry no hours — «весь день» is what the grid itself draws.
      const time = entry.start != null && entry.end != null ? `${entry.start}–${entry.end}` : "весь день";
      return `${time} · ${entry.title ?? categoryLabel(entry.category)}`;
    })
    .join(", ");
  return `Теперь на ${dayLabel(opts.date)} у тебя: ${parts}.`;
}
