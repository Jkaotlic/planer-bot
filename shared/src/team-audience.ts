import { z } from "zod";
import { isAbsentOn } from "./absence";
import type { AnnouncementRole } from "./announce-audience";
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

/**
 * Один потенциальный адресат опроса или заказа — контракт `GET /api/team-audience`.
 * `onShift` — только у этой ручки: анонсам всё равно, кто сегодня на месте. Здесь,
 * а не в клиенте мини-аппа: тот же выбор с 2026-10-06 рисует и консоль.
 */
export interface AudienceCandidate {
  id: number;
  displayName: string;
  reachable: boolean;
  role: AnnouncementRole;
  onShift: boolean;
}

/** «Выбрать» без единой галочки — слать некому; сервер ответил бы «Некому отправить». */
export function audienceReady(audience: TeamAudience): boolean {
  return !(audience.kind === "picked" && audience.employeeIds.length === 0);
}

export interface AudiencePreview {
  reachable: string[];
  unreachable: string[];
  observerCopies: string[];
}

/**
 * Кому уйдёт — поимённо, до отправки.
 *
 * Наблюдателям сервер шлёт копию любого опроса и заказа, кого бы ни выбрали
 * (`resolveAudience`, решение 2026-10-06). Без отдельной строки запускающий думал
 * бы, что их не позвали. Наблюдатель без Telegram в копии не попадает: его не
 * звали, и в «не дойдёт» ему делать нечего.
 */
export function audiencePreview(people: readonly AudienceCandidate[], value: TeamAudience): AudiencePreview {
  const chosen =
    value.kind === "team" ? people
    : value.kind === "on_shift" ? people.filter((p) => p.onShift)
    : people.filter((p) => value.employeeIds.includes(p.id));
  const inChosen = new Set(chosen.map((p) => p.id));
  return {
    reachable: chosen.filter((p) => p.reachable).map((p) => p.displayName),
    unreachable: chosen.filter((p) => !p.reachable).map((p) => p.displayName),
    observerCopies: people
      .filter((p) => p.role === "observer" && p.reachable && !inChosen.has(p.id))
      .map((p) => p.displayName),
  };
}

/** Строки под выбором. `null` — строки нет вовсе: пустая «Не дойдёт: » читалась бы как сбой. */
export function audienceLines(preview: AudiencePreview): { goes: string; observers: string | null; unreachable: string | null } {
  return {
    goes: preview.reachable.length === 0 ? "Пока никого, кроме тебя." : `Уйдёт: ${preview.reachable.join(", ")} и тебе`,
    observers: preview.observerCopies.length > 0 ? `Наблюдателям — копия всегда: ${preview.observerCopies.join(", ")}` : null,
    unreachable: preview.unreachable.length > 0 ? `Не дойдёт: ${preview.unreachable.join(", ")} — не привязан(а) к боту` : null,
  };
}
