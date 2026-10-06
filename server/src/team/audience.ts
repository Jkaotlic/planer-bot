import { announcementRole, workingOn, type AnnouncementRole, type TeamAudience } from "@planer/shared";
import type { Db } from "../db/client";
import type { Employee } from "../db/schema";
import { listActive } from "../repo/employees";
import { listShiftsOverlapping } from "../repo/shifts";

/**
 * Кому на самом деле уйдёт опрос или заказ.
 *
 * Запускающий включён всегда и первым: он тоже голосует и тоже ест, а его
 * письмо — единственное место, где у него есть кнопки «Закрыть приём». Список
 * отдельно от `announcementRecipients`: там отправитель, наоборот, исключён —
 * анонс самому себе не нужен.
 *
 * Наблюдатель получает копию КАЖДОГО опроса и заказа — при «вся команда», «на смене»
 * и выборе вручную (решение 2026-10-06; до того — только «вся команда» и «на смене»
 * при смене в графике, решение 2026-09-30). Пресеты анонсов
 * остаются без наблюдателей — там другой вопрос: кому адресована новость.
 */
export function resolveAudience(
  db: Db,
  audience: TeamAudience,
  creatorId: number,
  today: string,
): { reachable: Employee[]; unreachable: string[] } {
  const active = listActive(db);
  const byId = new Map(active.map((e) => [e.id, e]));

  let picked: number[];
  if (audience.kind === "team") {
    picked = active.map((e) => e.id);
  } else if (audience.kind === "on_shift") {
    const working = new Set(workingOn(listShiftsOverlapping(db, today, today), today));
    picked = active.filter((e) => working.has(e.id)).map((e) => e.id);
  } else {
    picked = audience.employeeIds;
  }

  const ordered = [creatorId, ...picked.filter((id) => id !== creatorId)];
  const seen = new Set<number>();
  const reachable: Employee[] = [];
  const unreachable: string[] = [];
  for (const id of ordered) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = byId.get(id);
    if (!e) continue;
    if (e.telegramUserId == null) unreachable.push(e.displayName);
    else reachable.push(e);
  }
  // Observers get a copy of every poll and order, whoever it was addressed to — the
  // owner's decision of 2026-10-06: they watch the team, and «on shift» or a hand-picked
  // list silently left them out. Added after the chosen people so the order of the
  // creator's report stays as picked. An unlinked observer was not asked for, so their
  // absence is not reported to the creator as «unreachable».
  for (const e of active) {
    if (!e.isObserver || seen.has(e.id) || e.telegramUserId == null) continue;
    seen.add(e.id);
    reachable.push(e);
  }
  return { reachable, unreachable };
}

export interface AudienceCandidate {
  id: number;
  displayName: string;
  reachable: boolean;
  role: AnnouncementRole;
  onShift: boolean;
}

/** Список для экрана выбора адресатов: смотрящий не показывается — он в рассылке всегда. */
export function audienceCandidates(db: Db, viewerId: number, today: string): AudienceCandidate[] {
  const working = new Set(workingOn(listShiftsOverlapping(db, today, today), today));
  return listActive(db)
    .filter((e) => e.id !== viewerId)
    .map((e) => ({
      id: e.id,
      displayName: e.displayName,
      reachable: e.telegramUserId != null,
      role: announcementRole(e),
      onShift: working.has(e.id),
    }));
}
