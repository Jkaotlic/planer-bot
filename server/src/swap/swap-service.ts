import { and, eq, ne, or } from "drizzle-orm";
import { isSwappable, isIdenticalShift, validateSwap, nextSwapStatus, shiftInterval, absMinutes, type Shift as DomainShift } from "@planer/shared";
import type { Db } from "../db/client";
import { shifts, swapRequests, type Shift as DbShift, type SwapRequest } from "../db/schema";
import { getShift, listShiftsByEmployee } from "../repo/shifts";
import { createSwapRequest, getSwapRequest, setSwapStatus, findPendingSwapForPair } from "../repo/swaps";

export type SwapNow = { date: string; time: string };
export type SwapOutcome =
  | { ok: true; request: SwapRequest; counterpartyId: number; cancelledSiblings?: SwapRequest[] }
  /** `expired` is set when the failure also moved the request to `expired` for
   *  good. The person who tapped learns it from `reason`; the other side learns
   *  nothing unless the caller tells them, which is what this is for. */
  | { ok: false; reason: string; expired?: SwapRequest };

function toDomain(s: DbShift): DomainShift & { category: DbShift["category"] } {
  return { id: s.id, date: s.date, start: s.start as string, end: s.end as string, templateId: s.templateId, title: s.title, employeeId: s.employeeId, note: s.note, category: s.category };
}

function timedOthers(db: Db, employeeId: number, excludeShiftId: number): DomainShift[] {
  return listShiftsByEmployee(db, employeeId)
    .filter((s) => s.id !== excludeShiftId && s.start != null && s.end != null)
    .map(toDomain);
}

export function createSwap(
  db: Db,
  input: { fromEmployeeId: number; fromShiftId: number; toShiftId: number; message?: string },
  now: SwapNow,
): SwapOutcome {
  const fromShift = getShift(db, input.fromShiftId);
  const toShift = getShift(db, input.toShiftId);
  if (!fromShift || !toShift) return { ok: false, reason: "shift_not_found" };
  if (fromShift.employeeId !== input.fromEmployeeId) return { ok: false, reason: "not_your_shift" };
  if (toShift.employeeId == null) return { ok: false, reason: "target_unassigned" };
  if (toShift.employeeId === input.fromEmployeeId) return { ok: false, reason: "same_person" };
  if (!isSwappable(fromShift.category) || !isSwappable(toShift.category)) return { ok: false, reason: "not_swappable" };
  // A roster import writes an unreadable cell as a `shift` with no clock times.
  // There's nothing to hand over and nothing to compare against "now".
  if (fromShift.start == null || fromShift.end == null || toShift.start == null || toShift.end == null) {
    return { ok: false, reason: "not_swappable" };
  }
  // The same rule accept-time already enforces, applied where it costs nothing:
  // a request on a shift that has started can only ever answer «Смена уже прошла»,
  // after pinging the counterparty with buttons that look live.
  const nowAbs = absMinutes(now.date, now.time);
  if (shiftInterval(toDomain(fromShift)).start <= nowAbs) return { ok: false, reason: "from-shift-in-past" };
  if (shiftInterval(toDomain(toShift)).start <= nowAbs) return { ok: false, reason: "to-shift-in-past" };
  // A no-op swap: same day, same kind of shift — nothing would actually change hands.
  if (isIdenticalShift(fromShift, toShift)) return { ok: false, reason: "identical-shift" };
  // Same trade already open — either this person's own request («дождись ответа»)
  // or the counterparty's request for the very same pair («ответь ему»).
  const open = findPendingSwapForPair(db, input.fromShiftId, input.toShiftId);
  if (open) return { ok: false, reason: open.pairing === "same" ? "duplicate" : "mirror" };
  const request = createSwapRequest(db, {
    fromEmployeeId: input.fromEmployeeId,
    fromShiftId: input.fromShiftId,
    toEmployeeId: toShift.employeeId,
    toShiftId: input.toShiftId,
    message: input.message ?? null,
  });
  return { ok: true, request, counterpartyId: toShift.employeeId };
}

export function acceptSwap(db: Db, requestId: number, actingEmployeeId: number, now: SwapNow): SwapOutcome {
  const req = getSwapRequest(db, requestId);
  if (!req) return { ok: false, reason: "not_found" };
  if (req.toEmployeeId !== actingEmployeeId) return { ok: false, reason: "not_yours" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };

  const expired = nextSwapStatus("pending", "expire");
  // A null pointer means the entry was deleted out from under the request — the
  // «unavailable» branch below already knows what to do with a missing shift.
  const fromShift = req.fromShiftId == null ? undefined : getShift(db, req.fromShiftId);
  const toShift = req.toShiftId == null ? undefined : getShift(db, req.toShiftId);
  if (
    !fromShift || !toShift ||
    fromShift.start == null || fromShift.end == null ||
    toShift.start == null || toShift.end == null ||
    !isSwappable(fromShift.category) || !isSwappable(toShift.category)
  ) {
    setSwapStatus(db, requestId, expired);
    return { ok: false, reason: "unavailable", expired: getSwapRequest(db, requestId) ?? { ...req, status: expired } };
  }

  const validation = validateSwap({
    fromShift: toDomain(fromShift),
    toShift: toDomain(toShift),
    fromEmployeeId: req.fromEmployeeId,
    toEmployeeId: req.toEmployeeId,
    fromOtherShifts: timedOthers(db, req.fromEmployeeId, fromShift.id),
    toOtherShifts: timedOthers(db, req.toEmployeeId, toShift.id),
    now,
  });
  if (!validation.ok) {
    setSwapStatus(db, requestId, expired);
    return { ok: false, reason: validation.reason, expired: getSwapRequest(db, requestId) ?? { ...req, status: expired } };
  }

  const accepted = nextSwapStatus("pending", "accept");
  // Safe read-validate-write under single-process better-sqlite3 (spec §11); revisit if horizontally scaled.
  // Journaling this swap happens in the HTTP layer, after this transaction returns —
  // never inside it, so a bookkeeping failure can never roll back a swap that already
  // succeeded.
  let cancelledSiblings: SwapRequest[] = [];
  db.transaction((tx) => {
    tx.update(shifts).set({ employeeId: req.toEmployeeId }).where(eq(shifts.id, fromShift.id)).run();
    tx.update(shifts).set({ employeeId: req.fromEmployeeId }).where(eq(shifts.id, toShift.id)).run();
    tx.update(swapRequests).set({ status: accepted, resolvedAt: new Date() }).where(eq(swapRequests.id, requestId)).run();
    const siblings = tx
      .select()
      .from(swapRequests)
      .where(and(
        eq(swapRequests.status, "pending"),
        ne(swapRequests.id, requestId),
        or(
          eq(swapRequests.fromShiftId, fromShift.id),
          eq(swapRequests.toShiftId, fromShift.id),
          eq(swapRequests.fromShiftId, toShift.id),
          eq(swapRequests.toShiftId, toShift.id),
        ),
      ))
      .all();
    for (const s of siblings) {
      tx.update(swapRequests).set({ status: "cancelled", resolvedAt: new Date() }).where(eq(swapRequests.id, s.id)).run();
    }
    cancelledSiblings = siblings;
  });
  // Callers notify each sibling's counterparty — the person still looking at a
  // now-stale Принять/Отклонить message — since neither shift they were about
  // to trade is theirs to trade anymore.
  return {
    ok: true,
    request: getSwapRequest(db, requestId) ?? { ...req, status: accepted },
    counterpartyId: req.fromEmployeeId,
    cancelledSiblings,
  };
}

export function declineSwap(db: Db, requestId: number, actingEmployeeId: number): SwapOutcome {
  const req = getSwapRequest(db, requestId);
  if (!req) return { ok: false, reason: "not_found" };
  if (req.toEmployeeId !== actingEmployeeId) return { ok: false, reason: "not_yours" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };
  const declined = nextSwapStatus("pending", "decline");
  setSwapStatus(db, requestId, declined);
  return { ok: true, request: getSwapRequest(db, requestId) ?? { ...req, status: declined }, counterpartyId: req.fromEmployeeId };
}

export function cancelSwap(db: Db, requestId: number, actingEmployeeId: number): SwapOutcome {
  const req = getSwapRequest(db, requestId);
  if (!req) return { ok: false, reason: "not_found" };
  if (req.fromEmployeeId !== actingEmployeeId) return { ok: false, reason: "not_yours" };
  if (req.status !== "pending") return { ok: false, reason: "not_pending" };
  const cancelled = nextSwapStatus("pending", "cancel");
  setSwapStatus(db, requestId, cancelled);
  return { ok: true, request: getSwapRequest(db, requestId) ?? { ...req, status: cancelled }, counterpartyId: req.toEmployeeId };
}
