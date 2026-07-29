import { describe, expect, it } from "vitest";
import { withBusy, withoutBusy } from "./busy-set";

describe("withBusy / withoutBusy", () => {
  it("adds an id without disturbing the ones already busy", () => {
    const busy = withBusy(new Set([1]), 2);
    expect([...busy].sort()).toEqual([1, 2]);
  });

  it("removes only the given id, leaving every other row busy", () => {
    // The exact bug this guards against: row A stays busy while row B's
    // request resolves and clears itself.
    const busy = withBusy(withBusy(new Set(), 1), 2);
    const afterBResolves = withoutBusy(busy, 2);
    expect(afterBResolves.has(1)).toBe(true);
    expect(afterBResolves.has(2)).toBe(false);
  });

  it("never mutates the set it was given", () => {
    const original = new Set([1]);
    withBusy(original, 2);
    withoutBusy(original, 1);
    expect([...original]).toEqual([1]);
  });

  it("is a no-op removing an id that was never busy", () => {
    const busy = withoutBusy(new Set([1]), 99);
    expect([...busy]).toEqual([1]);
  });
});
