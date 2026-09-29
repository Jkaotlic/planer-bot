import { z } from "zod";
import { isAbsentOn } from "./absence";
import type { EntryCategory } from "./category";

/**
 * Кому уходит опрос или заказ еды.
 *
 * Три способа, а не два, как у анонсов: обед заказывают те, кто сегодня на
 * месте, и дёргать людей из дома вопросом «что будешь есть» — ровно та
 * рассылка, за которую бота начинают глушить. «Сегодня на смене» бот знает сам,
 * из графика, — человеку не надо отмечать это руками.
 */
export type TeamAudience =
  | { kind: "team" }
  | { kind: "on_shift" }
  | { kind: "picked"; employeeIds: number[] };

/** Потолок — тот же, что у анонсов: больше в команде не бывает, а рассылка идёт
 *  из процесса, который держит и long-polling бота. */
export const TEAM_AUDIENCE_MAX = 200;

export const teamAudienceSchema: z.ZodType<TeamAudience> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("team") }).strict(),
  z.object({ kind: z.literal("on_shift") }).strict(),
  z
    .object({
      kind: z.literal("picked"),
      employeeIds: z.array(z.number().int().positive()).min(1).max(TEAM_AUDIENCE_MAX),
    })
    .strict(),
]);

/**
 * Кто «на месте» в этот день — не только обычная смена.
 *
 * Дежурство, выходная работа и выезд — тоже рабочий день, и человек на них так
 * же хочет обедать. Отсутствие (отпуск, больничный, командировка) перебивает
 * смену: больной, чья смена ещё висит на нём до передачи, обедать с командой не
 * будет — та же ловушка, что закрыта `isAbsentOn` в напоминаниях.
 */
const WORKING: ReadonlySet<EntryCategory> = new Set(["shift", "duty", "weekend_work", "offsite"]);

export function workingOn(
  entries: readonly { employeeId: number | null; category: EntryCategory; date: string; endDate: string | null }[],
  date: string,
): number[] {
  const ids = new Set<number>();
  for (const e of entries) {
    if (e.employeeId == null || !WORKING.has(e.category)) continue;
    if (!(e.date <= date && date <= (e.endDate ?? e.date))) continue;
    if (isAbsentOn(entries, e.employeeId, date)) continue;
    ids.add(e.employeeId);
  }
  return [...ids];
}
