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
  /**
   * Who the line is addressed to. The default «worker» is the letter this
   * function was written for, and it must not change.
   *
   * «admins» differs in two ways, both for one reason — the admin has just read
   * WHAT was recorded and needs to know what is now UNCOVERED. So the named
   * entry is dropped from the list rather than repeated, and a day holding
   * nothing else produces no line at all: a fortnight of sick leave would
   * otherwise spell out fourteen lines of «ничего».
   */
  voice?: "worker" | "admins";
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
  const all = listShiftsOverlapping(db, opts.date, opts.date).filter(
    (entry) => entry.employeeId === opts.employeeId,
  );
  const forAdmins = opts.voice === "admins";
  // One read of the day for both voices. Two reads would drift, and two letters
  // about one day would start saying different things — the very defect fixed
  // in d9f16bc.
  const mine = forAdmins ? all.filter((entry) => entry.id !== opts.keepSilentForEntryId) : all;

  if (forAdmins) {
    if (mine.length === 0) return null;
  } else {
    const onlyTheNamedOne = mine.length === 1 && mine[0]!.id === opts.keepSilentForEntryId;
    if (onlyTheNamedOne) return null;
    if (mine.length === 0) return `Теперь на ${dayLabel(opts.date)} у тебя ничего.`;
  }

  const parts = mine
    .map((entry) => {
      // Absences carry no hours — «весь день» is what the grid itself draws.
      const time = entry.start != null && entry.end != null ? `${entry.start}–${entry.end}` : "весь день";
      return `${time} · ${entry.title ?? categoryLabel(entry.category)}`;
    })
    .join(", ");
  const lead = forAdmins ? `На ${dayLabel(opts.date)} стоят: ` : `Теперь на ${dayLabel(opts.date)} у тебя: `;
  return `${lead}${parts}.`;
}
