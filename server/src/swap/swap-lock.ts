import { and, eq, or } from "drizzle-orm";
import type { Db } from "../db/client";
import { swapRequests } from "../db/schema";
import { setSwapsLocked, type DbOrTx } from "../repo/settings";
import { swapAuditPayload, type SwapAuditPayload } from "../util/message-lines";

/**
 * Flipping the team-wide swap lock, and what it costs the people mid-trade.
 *
 * Locking cancels every still-open request: the counterparty is holding a chat
 * message with live-looking «Принять»/«Отклонить» buttons whose only possible
 * answer would now be an error. The same thing already happens when an accepted
 * swap knocks out its siblings, so this is the established shape, not a new idea.
 *
 * Everything here is synchronous and inside one transaction, and the caller does
 * the `await` messaging AFTERWARDS. That ordering is not stylistic: the `races`
 * audit lens already caught a double broadcast in this codebase caused by a
 * status guard written *after* a loop of awaits.
 */

/** Payloads of the requests this call cancelled — for the caller to notify from. */
export function setSwapLock(db: Db, locked: boolean, actorEmployeeId: number): SwapAuditPayload[] {
  // Read the payloads BEFORE the status changes: `swapAuditPayload` resolves
  // names and shift lines, and those must describe the trade as it stood.
  const pending = locked ? listPending(db) : [];
  const payloads = pending.map((request) => swapAuditPayload(db, request));

  db.transaction((tx) => {
    // `setSwapsLocked` takes `DbOrTx` precisely so this needs no cast: the flag
    // and the cancellations are one fact, and half of it landing is worse than
    // neither — an admin would see «закрыто» while the buttons still worked.
    setSwapsLocked(tx, locked, actorEmployeeId);
    cancelAll(tx, pending);
  });

  return payloads;
}

/** Same, for one person being taken out of swaps: their open requests, both ways. */
export function cancelSwapsForEmployee(db: Db, employeeId: number): SwapAuditPayload[] {
  const pending = db
    .select()
    .from(swapRequests)
    .where(and(
      eq(swapRequests.status, "pending"),
      or(eq(swapRequests.fromEmployeeId, employeeId), eq(swapRequests.toEmployeeId, employeeId)),
    ))
    .all();
  const payloads = pending.map((request) => swapAuditPayload(db, request));

  db.transaction((tx) => cancelAll(tx, pending));

  return payloads;
}

function listPending(db: Db) {
  return db.select().from(swapRequests).where(eq(swapRequests.status, "pending")).all();
}

/** The one write both callers make. Extracted so the two paths cannot drift on
 *  what «cancelled» means or on whether `resolvedAt` gets stamped. */
function cancelAll(tx: DbOrTx, pending: readonly { id: number }[]): void {
  for (const request of pending) {
    tx.update(swapRequests)
      .set({ status: "cancelled", resolvedAt: new Date() })
      .where(eq(swapRequests.id, request.id))
      .run();
  }
}
