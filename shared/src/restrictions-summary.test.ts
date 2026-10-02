import { describe, expect, it } from "vitest";
import { restrictionsSummary } from "./restrictions-summary";

const CASES: Array<[boolean, boolean, boolean, string]> = [
  [false, false, false, "нет"],
  [true, false, false, "наблюдатель"],
  [false, true, false, "без назначений"],
  [false, false, true, "без обменов"],
  [false, true, true, "без назначений, без обменов"],
  [true, true, false, "наблюдатель, без назначений"],
  [true, false, true, "наблюдатель, без обменов"],
  [true, true, true, "наблюдатель, без назначений, без обменов"],
];

describe("restrictionsSummary", () => {
  it.each(CASES)("наблюдатель=%s, назначения=%s, обмены=%s → «%s»", (isObserver, excludedFromAssignment, excludedFromSwaps, expected) => {
    expect(restrictionsSummary({ isObserver, excludedFromAssignment, excludedFromSwaps })).toBe(expected);
  });
});
