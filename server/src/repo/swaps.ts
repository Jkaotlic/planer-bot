import { and, desc, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { swapRequests, type SwapRequest } from "../db/schema";
import type { SwapStatus } from "@planer/shared";

export function createSwapRequest(
  db: Db,
  data: { fromEmployeeId: number; fromShiftId: number; toEmployeeId: number; toShiftId: number; message?: string | null },
): SwapRequest {
  return db
    .insert(swapRequests)
    .values({
      fromEmployeeId: data.fromEmployeeId,
      fromShiftId: data.fromShiftId,
      toEmployeeId: data.toEmployeeId,
      toShiftId: data.toShiftId,
      message: data.message ?? null,
    })
    .returning()
    .all()[0]!;
}

export function getSwapRequest(db: Db, id: number): SwapRequest | undefined {
  return db.select().from(swapRequests).where(eq(swapRequests.id, id)).get();
}

export function setSwapStatus(db: Db, id: number, status: SwapStatus): void {
  db.update(swapRequests).set({ status, resolvedAt: new Date() }).where(eq(swapRequests.id, id)).run();
}

/**
 * Is this exact pair of shifts already up for trade?
 *
 * Direction-blind on purpose: «A отдаёт SA, хочет SB» and «B отдаёт SB, хочет SA»
 * are the same trade written from the two ends, and two rows for it meant that
 * accepting one auto-cancelled the other and sent its people «приняли ✅» and
 * «отменилось» within the same second. `pairing` says which of the two it found,
 * so the caller can tell somebody «дождись ответа» from «ответь ему».
 */
export function findPendingSwapForPair(
  db: Db,
  fromShiftId: number,
  toShiftId: number,
): { pairing: "same" | "mirror" } | null {
  const rows = db
    .select({ from: swapRequests.fromShiftId, to: swapRequests.toShiftId })
    .from(swapRequests)
    .where(and(
      eq(swapRequests.status, "pending"),
      or(
        and(eq(swapRequests.fromShiftId, fromShiftId), eq(swapRequests.toShiftId, toShiftId)),
        and(eq(swapRequests.fromShiftId, toShiftId), eq(swapRequests.toShiftId, fromShiftId)),
      ),
    ))
    .all();
  const exact = rows.find((r) => r.from === fromShiftId && r.to === toShiftId);
  if (exact) return { pairing: "same" };
  return rows.length > 0 ? { pairing: "mirror" } : null;
}

/** Still-open requests that would be invalidated by this shift going away — read
 *  before the deletion, while their shift lines can still be built. */
export function listPendingSwapsForShift(db: Db, shiftId: number): SwapRequest[] {
  return db
    .select()
    .from(swapRequests)
    .where(and(
      eq(swapRequests.status, "pending"),
      or(eq(swapRequests.fromShiftId, shiftId), eq(swapRequests.toShiftId, shiftId)),
    ))
    .all();
}

export function listSwapsForEmployee(db: Db, employeeId: number): SwapRequest[] {
  return db
    .select()
    .from(swapRequests)
    .where(or(eq(swapRequests.fromEmployeeId, employeeId), eq(swapRequests.toEmployeeId, employeeId)))
    .orderBy(desc(swapRequests.createdAt))
    .limit(100)
    .all();
}
