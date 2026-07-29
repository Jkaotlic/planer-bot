/**
 * Which rows are mid-request, as a set instead of a single id. A screen with
 * several independently-actionable rows (two pending swaps, two open weekend
 * slots) must keep each row disabled for exactly as long as *its own* request
 * is in flight — a single shared "busy id" gets overwritten by whichever row
 * was tapped last, re-enabling an earlier row's buttons while that row's
 * request is still running and inviting a second, concurrent tap on it.
 *
 * Pure add/remove so the transition is testable without touching React state.
 */
export function withBusy(busy: ReadonlySet<number>, id: number): Set<number> {
  return new Set(busy).add(id);
}

export function withoutBusy(busy: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(busy);
  next.delete(id);
  return next;
}
