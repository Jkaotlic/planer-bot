import { and, eq, ne, or } from "drizzle-orm";
import { isSwappable, isIdenticalShift, validateSwap, nextSwapStatus, type Shift as DomainShift } from "@planer/shared";
import type { Db } from "../db/client";
import { shifts, swapRequests, auditLog, type Shift as DbShift, type SwapRequest } from "../db/schema";
import { getShift, listShiftsByEmployee } from "../repo/shifts";
import { createSwapRequest, getSwapRequest, setSwapStatus, hasPendingSwap } from "../repo/swaps";

export type SwapNow = { date: string; time: string };
export type SwapOutcome =
  | { ok: true; request: SwapRequest; counterpartyId: number }
  | { ok: false; reason: string };

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
): SwapOutcome {
  const fromShift = getShift(db, input.fromShiftId);
  const toShift = getShift(db, input.toShiftId);
  if (!fromShift || !toShift) return { ok: false, reason: "shift_not_found" };
  if (fromShift.employeeId !== input.fromEmployeeId) return { ok: false, reason: "not_your_shift" };
  if (toShift.employeeId == null) return { ok: false, reason: "target_unassigned" };
  if (toShift.employeeId === input.fromEmployeeId) return { ok: false, reason: "same_person" };
  if (!isSwappable(fromShift.category) || !isSwappable(toShift.category)) return { ok: false, reason: "not_swappable" };
  // A no-op swap: same day, same kind of shift — nothing would actually change hands.
  if (isIdenticalShift(fromShift, toShift)) return { ok: false, reason: "identical-shift" };
  if (hasPendingSwap(db, input.fromShiftId, input.toShiftId)) return { ok: false, reason: "duplicate" };
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
  const fromShift = getShift(db, req.fromShiftId);
  const toShift = getShift(db, req.toShiftId);
  if (
    !fromShift || !toShift ||
    fromShift.start == null || fromShift.end == null ||
    toShift.start == null || toShift.end == null ||
    !isSwappable(fromShift.category) || !isSwappable(toShift.category)
  ) {
    setSwapStatus(db, requestId, expired);
    return { ok: false, reason: "unavailable" };
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
    return { ok: false, reason: validation.reason };
  }

  const accepted = nextSwapStatus("pending", "accept");
  // Safe read-validate-write under single-process better-sqlite3 (spec §11); revisit if horizontally scaled.
  db.transaction((tx) => {
    tx.update(shifts).set({ employeeId: req.toEmployeeId }).where(eq(shifts.id, fromShift.id)).run();
    tx.update(shifts).set({ employeeId: req.fromEmployeeId }).where(eq(shifts.id, toShift.id)).run();
    tx.update(swapRequests).set({ status: accepted, resolvedAt: new Date() }).where(eq(swapRequests.id, requestId)).run();
    tx.insert(auditLog).values({
      type: "swap_done",
      actorEmployeeId: req.toEmployeeId,
      payload: { requestId, fromEmployeeId: req.fromEmployeeId, toEmployeeId: req.toEmployeeId, fromShiftId: fromShift.id, toShiftId: toShift.id },
    }).run();
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
  });
  return { ok: true, request: getSwapRequest(db, requestId) ?? { ...req, status: accepted }, counterpartyId: req.fromEmployeeId };
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
