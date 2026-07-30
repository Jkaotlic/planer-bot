import type { SwapRequest } from "../api/client";

export interface SwapBuckets {
  /** Somebody is waiting on YOUR answer. */
  incoming: SwapRequest[];
  /** You are waiting on THEIRS. */
  outgoing: SwapRequest[];
  /** Settled, either way round — newest first. */
  archived: SwapRequest[];
}

/**
 * Three buckets from one list.
 *
 * The archive is derived from `status`, not stored: a request is settled or it
 * isn't, and a second source of truth for that could only ever disagree with the
 * first. Nothing new goes to the server.
 *
 * It also closes a hole. The screen used to keep incoming requests only while
 * they were pending, so an accepted or declined one vanished the moment it was
 * answered — the history was outgoing-only.
 */
export function splitSwaps(swaps: readonly SwapRequest[]): SwapBuckets {
  const buckets: SwapBuckets = { incoming: [], outgoing: [], archived: [] };
  for (const swap of swaps) {
    if (swap.status !== "pending") buckets.archived.push(swap);
    else if (swap.direction === "incoming") buckets.incoming.push(swap);
    else buckets.outgoing.push(swap);
  }
  buckets.archived.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return buckets;
}

/**
 * Has this shift already begun?
 *
 * The server refuses a swap proposal on a shift that has started (the same rule
 * it has always applied when accepting one), so the picker must not offer it —
 * same principle as the identical-shift filter next to it: a rejection after the
 * tap is worse than not showing the option.
 *
 * A `shift` row with no time comes from an unreadable roster cell; there is
 * nothing to hand over, and the server calls it `not_swappable`.
 */
export function hasStarted(shift: { date: string; start: string | null }, now: Date): boolean {
  if (!shift.start) return true;
  return new Date(`${shift.date}T${shift.start}`).getTime() <= now.getTime();
}
