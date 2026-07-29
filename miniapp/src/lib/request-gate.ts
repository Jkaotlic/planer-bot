/**
 * A monotonic "only the newest request wins" gate. Any screen that fires an
 * async request whose result lands in shared state (and could be superseded
 * by a newer request — a week navigation, a background action) hands out a
 * ticket with `begin()` and, once its request settles, checks `isLatest()`
 * before applying the result. `invalidate()` supersedes every ticket handed
 * out so far without minting a new one — for a caller that wants to void
 * whatever is in flight without starting a request of its own.
 *
 * Extracted from `team-schedule.ts` (where `TeamScreen` first needed it for
 * the today/week mode race) so `AdminScheduleScreen` can reuse the same idea
 * for its own week-navigation race instead of inventing a third mechanism.
 */
export interface LatestRequestGate {
  begin(): number;
  isLatest(id: number): boolean;
  invalidate(): void;
}

export function createLatestRequestGate(): LatestRequestGate {
  let latest = 0;
  return {
    begin: () => ++latest,
    isLatest: (id) => id === latest,
    invalidate: () => {
      latest += 1;
    },
  };
}
