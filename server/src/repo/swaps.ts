import { and, eq, or } from "drizzle-orm";
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

export function listSwapsForEmployee(db: Db, employeeId: number): SwapRequest[] {
  return db
    .select()
    .from(swapRequests)
    .where(and(or(eq(swapRequests.fromEmployeeId, employeeId), eq(swapRequests.toEmployeeId, employeeId))))
    .all();
}
