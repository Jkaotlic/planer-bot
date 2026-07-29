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
