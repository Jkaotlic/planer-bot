import { shiftsOverlap } from "@planer/shared";
import type { Db } from "../db/client";
import type { Handover, Shift } from "../db/schema";
import { recordAudit } from "../repo/audit";
import { getEmployeeById } from "../repo/employees";
import {
  addDecline,
  createHandover,
  getHandover,
  listDeclines,
  listHandoversForEntry,
  updateHandover,
} from "../repo/handovers";
import { getShift, listShiftsOverlapping, updateShift } from "../repo/shifts";
import { entryLineOf, nameOf } from "../util/message-lines";
import { handoverCandidates } from "./candidates";
import {
  handoverCancelledText,
  handoverEscalationText,
  handoverFanText,
  handoverOfferText,
  handoverTakenTextForAdmins,
  handoverTakenTextForGiver,
  handoverTakenTextForTaker,
} from "./handover-notice";

/**
 * Where a handover's messages go.
 *
 * An interface rather than a `Bot`, for one reason: a test must be able to see
 * WHO was written to. A message reaching the wrong person is the worst defect
 * this feature can have, and «сколько сообщений ушло» cannot see it.
 */
export interface HandoverMessenger {
  /** A personal offer, with «Беру» / «Не могу» under it. */
  offer(employeeId: number, handoverId: number, text: string): Promise<void>;
  /** The fan-out: the same shift, one «Беру» button, everybody still free. */
  fan(employeeIds: readonly number[], handoverId: number, text: string): Promise<void>;
  /** A plain message with nothing to tap. */
  plain(employeeId: number, text: string): Promise<void>;
  admins(text: string): Promise<void>;
}

export interface HandoverDeps {
  db: Db;
  config: { teamTz: string };
  messenger: HandoverMessenger;
}

export type Outcome = { ok: true } | { ok: false; reason: string };

/** The line every message and every journal row uses for this shift. */
function lineOf(shift: Shift): string {
  return entryLineOf(shift);
}

function auditPayload(db: Db, handover: Handover, shift: Shift | undefined, toEmployeeId: number | null) {
  return {
    handoverId: handover.id,
    shiftId: handover.shiftId,
    shiftLine: shift ? lineOf(shift) : null,
    fromEmployeeId: handover.fromEmployeeId,
    fromName: nameOf(db, handover.fromEmployeeId),
    toEmployeeId,
    toName: toEmployeeId != null ? nameOf(db, toEmployeeId) : null,
  };
}

function shiftOf(db: Db, handover: Handover): Shift | undefined {
  return handover.shiftId == null ? undefined : getShift(db, handover.shiftId);
}

/**
 * Every day a sick leave covers, as ISO dates.
 *
 * Local rather than shared: `eachDayIso` in `@planer/shared` does the same, and
 * this file needs the sick leave's own span only.
 */
function daysOf(entry: Shift): string[] {
  const days: string[] = [];
  for (let day = entry.date; day <= (entry.endDate ?? entry.date); ) {
    days.push(day);
    const next = new Date(`${day}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    day = next.toISOString().slice(0, 10);
  }
  return days;
}

/**
 * A sick leave was recorded — open one handover per shift it takes away.
 *
 * One per shift, never one per sick leave: a colleague ready to cover Wednesday
 * must not be forced to take Thursday too, and refusing Thursday must not carry
 * Wednesday away with it.
 *
 * Handovers are born with no addressee: the person is about to choose one in the
 * form. `offeredAt` starts counting from now anyway, so somebody who closes the
 * form and forgets still gets a fan-out three hours later instead of a shift
 * quietly left on a sick person.
 */
export async function startHandovers(
  deps: HandoverDeps,
  input: { sickEntry: Shift; employeeId: number },
): Promise<Handover[]> {
  const { db } = deps;
  const days = daysOf(input.sickEntry);
  const mine = listShiftsOverlapping(db, days[0]!, days[days.length - 1]!).filter(
    (entry) =>
      entry.employeeId === input.employeeId &&
      entry.id !== input.sickEntry.id &&
      // Only real work is handed over. Another absence overlapping the sick leave
      // is not a shift anybody can take, and offering it would read as «возьми
      // мой отпуск».
      entry.category !== "sick_leave" &&
      entry.category !== "vacation" &&
      entry.category !== "business_trip" &&
      entry.category !== "offsite",
  );

  // Extending a sick leave runs this again over days that already have offers.
  // Without this, «поболею ещё день» would re-ask the whole team about Wednesday.
  const alreadyOffered = new Set(
    listHandoversForEntry(db, input.sickEntry.id)
      .filter((handover) => handover.status !== "cancelled")
      .map((handover) => handover.shiftId),
  );

  const made: Handover[] = [];
  for (const shift of mine) {
    if (alreadyOffered.has(shift.id)) continue;
    const handover = createHandover(db, {
      shiftId: shift.id,
      fromEmployeeId: input.employeeId,
      sickEntryId: input.sickEntry.id,
      status: "offered",
      offeredToEmployeeId: null,
    });
    // Nobody free at all: the ladder has no rungs left, so the admins are told at
    // once. Waiting three hours for an answer from nobody would be a lie told by
    // the interface.
    if (handoverCandidates(db, shift).length === 0) {
      const escalated = updateHandover(db, handover.id, { status: "fanned", escalatedAt: new Date() })!;
      recordAudit(db, "handover_escalated", input.employeeId, auditPayload(db, escalated, shift, null));
      await deps.messenger.admins(
        handoverEscalationText(nameOf(db, input.employeeId) ?? "Работник", lineOf(shift), [], 0),
      );
      made.push(escalated);
      continue;
    }
    made.push(handover);
  }
  return made;
}

/** The person picked a colleague. */
export async function offerTo(deps: HandoverDeps, handoverId: number, toEmployeeId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const shift = shiftOf(db, handover);
  if (!shift) return { ok: false, reason: "Смены больше нет — её изменил админ" };
  // The screen filters candidates already; checking again here is not
  // belt-and-braces but the actual guard — the screen is not a defence, it is a
  // convenience, and the request can arrive from anywhere.
  if (!handoverCandidates(db, shift, { excludeIds: listDeclines(db, handoverId) }).some((e) => e.id === toEmployeeId)) {
    return { ok: false, reason: "Этот коллега в это время занят" };
  }

  const updated = updateHandover(db, handoverId, {
    status: "offered",
    offeredToEmployeeId: toEmployeeId,
    offeredAt: new Date(),
  })!;
  recordAudit(db, "handover_offered", handover.fromEmployeeId, auditPayload(db, updated, shift, toEmployeeId));
  await deps.messenger.offer(
    toEmployeeId,
    handoverId,
    handoverOfferText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift)),
  );
  return { ok: true };
}

/** Nobody in particular any more — everybody still free gets asked. */
export async function fanOut(deps: HandoverDeps, handoverId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const shift = shiftOf(db, handover);
  if (!shift) return { ok: false, reason: "Смены больше нет" };

  const recipients = handoverCandidates(db, shift, { excludeIds: listDeclines(db, handoverId) }).map((e) => e.id);
  const updated = updateHandover(db, handoverId, { status: "fanned", offeredToEmployeeId: null })!;
  recordAudit(db, "handover_fanned", handover.fromEmployeeId, auditPayload(db, updated, shift, null));
  if (recipients.length > 0) {
    await deps.messenger.fan(
      recipients,
      handoverId,
      handoverFanText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift)),
    );
  }
  return { ok: true };
}

/** «Не могу». */
export async function declineHandover(deps: HandoverDeps, handoverId: number, employeeId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Эту смену уже закрыли" };
  }
  const shift = shiftOf(db, handover);
  addDecline(db, handoverId, employeeId);
  recordAudit(db, "handover_declined", employeeId, auditPayload(db, handover, shift, employeeId));
  // Straight to the fan-out: a refusal is an answer, and waiting out the silence
  // window after it would burn three hours on a question already answered.
  await fanOut(deps, handoverId);
  return { ok: true };
}

/**
 * «Беру».
 *
 * The claim and the move are ONE synchronous transaction, and it completes
 * BEFORE a single message is sent. This repository has already paid twice for
 * the other order — the birthday broadcast and the vacant-slot double post both
 * spammed the whole team, and both had the same shape: a status guard written
 * AFTER an await. better-sqlite3 is synchronous and this is one process, so a
 * claim that finishes before the first await cannot be raced.
 *
 * The double-booking check lives inside that transaction too: hours passed since
 * the offer went out, and «свободен» stops being true without warning.
 */
export async function takeHandover(deps: HandoverDeps, handoverId: number, employeeId: number): Promise<Outcome> {
  const { db } = deps;
  const claimed = db.transaction(() => {
    const handover = getHandover(db, handoverId);
    if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
      return { ok: false as const, reason: "Уже забрали или предложение отменили" };
    }
    const shift = shiftOf(db, handover);
    if (!shift) return { ok: false as const, reason: "Смены больше нет — её изменил админ" };

    const clash = listShiftsOverlapping(db, shift.date, shift.endDate ?? shift.date).some(
      (mine) =>
        mine.employeeId === employeeId &&
        mine.id !== shift.id &&
        (mine.start == null || mine.end == null || shift.start == null || shift.end == null
          ? true
          : shiftsOverlap(
              { date: mine.date, start: mine.start, end: mine.end },
              { date: shift.date, start: shift.start, end: shift.end },
            )),
    );
    if (clash) return { ok: false as const, reason: "У тебя в это время уже стоит своя смена" };

    updateShift(db, shift.id, { employeeId });
    const updated = updateHandover(db, handoverId, {
      status: "taken",
      takenByEmployeeId: employeeId,
      resolvedAt: new Date(),
    })!;
    return { ok: true as const, handover: updated, shift };
  });

  if (!claimed.ok) return claimed;

  // Everything below is I/O and may fail. The shift has already moved — the part
  // that must not depend on Telegram being reachable.
  const line = lineOf(claimed.shift);
  const takerName = nameOf(db, employeeId) ?? "Коллега";
  const giverName = nameOf(db, claimed.handover.fromEmployeeId) ?? "Коллега";
  recordAudit(db, "handover_taken", employeeId, auditPayload(db, claimed.handover, claimed.shift, employeeId));
  await deps.messenger.plain(employeeId, handoverTakenTextForTaker(line));
  await deps.messenger.plain(claimed.handover.fromEmployeeId, handoverTakenTextForGiver(takerName, line));
  await deps.messenger.admins(handoverTakenTextForAdmins(takerName, giverName, line));
  return { ok: true };
}

/** The admins are told the shift is still uncovered. Once, not every five minutes. */
export async function escalate(deps: HandoverDeps, handoverId: number): Promise<Outcome> {
  const { db } = deps;
  const handover = getHandover(db, handoverId);
  if (!handover || (handover.status !== "offered" && handover.status !== "fanned")) {
    return { ok: false, reason: "Передача уже закрыта" };
  }
  const shift = shiftOf(db, handover);
  if (!shift) return { ok: false, reason: "Смены больше нет" };

  const declinedIds = listDeclines(db, handoverId);
  const declinedNames = declinedIds.map((id) => getEmployeeById(db, id)?.displayName ?? `работник #${id}`);
  const silent = handoverCandidates(db, shift, { excludeIds: declinedIds }).length;

  const updated = updateHandover(db, handoverId, { escalatedAt: new Date() })!;
  recordAudit(db, "handover_escalated", null, auditPayload(db, updated, shift, null));
  await deps.messenger.admins(
    handoverEscalationText(
      nameOf(db, handover.fromEmployeeId) ?? "Работник",
      lineOf(shift),
      declinedNames,
      silent,
    ),
  );
  return { ok: true };
}

/** The shift started and nobody took it. Silent by design — the admins already know. */
export function expireHandover(deps: HandoverDeps, handoverId: number): void {
  updateHandover(deps.db, handoverId, { status: "expired", resolvedAt: new Date() });
}

/**
 * Cut the handovers loose from a sick leave that is about to be deleted.
 *
 * `sickEntryId` is a foreign key, so the entry row cannot go while handovers
 * point at it — the delete fails with `invalid_reference`, which is how this was
 * found. Nulling the pointer rather than deleting the handovers is the same
 * choice already made for `shiftId`: the row must outlive what it pointed at,
 * because «Аня отдавала эту смену, и её никто не взял» stays true after the sick
 * leave is gone.
 *
 * Call AFTER cancelling, never instead of it: this only unlinks, it tells nobody.
 */
export function detachHandoversFromEntry(db: Db, sickEntryId: number): void {
  for (const handover of listHandoversForEntry(db, sickEntryId)) {
    updateHandover(db, handover.id, { sickEntryId: null });
  }
}

/**
 * The sick leave went away, or shrank — kill the handovers it no longer justifies.
 *
 * `stillCoveredDates` is what the sick leave covers NOW: empty when it was
 * removed outright. A handover whose day is still covered stays alive, so
 * shortening a sick leave by one day does not cancel the other days' offers.
 *
 * Taken handovers are left alone on purpose. That shift already has an owner and
 * is in their schedule; «не выходи» after the fact would be a message about
 * something that is no longer true.
 */
export async function cancelHandoversForEntry(
  deps: HandoverDeps,
  sickEntryId: number,
  stillCoveredDates: readonly string[],
): Promise<number> {
  const { db } = deps;
  const covered = new Set(stillCoveredDates);
  let killed = 0;

  for (const handover of listHandoversForEntry(db, sickEntryId)) {
    if (handover.status !== "offered" && handover.status !== "fanned") continue;
    const shift = shiftOf(db, handover);
    if (shift && covered.has(shift.date)) continue;

    const updated = updateHandover(db, handover.id, { status: "cancelled", resolvedAt: new Date() })!;
    recordAudit(db, "handover_cancelled", handover.fromEmployeeId, auditPayload(db, updated, shift, null));
    killed += 1;
    if (!shift) continue;

    const text = handoverCancelledText(nameOf(db, handover.fromEmployeeId) ?? "Коллега", lineOf(shift));
    // Who is told: the one person waiting on a decision, or — if it had already
    // gone wide — everybody who could still have taken it. The fanned set is
    // recomputed rather than stored, so somebody who became busy meanwhile is not
    // told about an offer they could no longer have accepted anyway.
    if (handover.status === "offered" && handover.offeredToEmployeeId != null) {
      await deps.messenger.plain(handover.offeredToEmployeeId, text);
    } else if (handover.status === "fanned") {
      const declined = listDeclines(db, handover.id);
      for (const employee of handoverCandidates(db, shift, { excludeIds: declined })) {
        await deps.messenger.plain(employee.id, text);
      }
    }
  }
  return killed;
}
