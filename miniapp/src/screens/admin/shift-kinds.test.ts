import { describe, expect, it } from "vitest";
import { poolSummary, toggleId, togglePreference } from "./AdminShiftKinds";

describe("poolSummary", () => {
  it("calls an empty pool «все», not «никто»", () => {
    // The whole difference between the screen reading as a whitelist and as a
    // blacklist: an unconfigured preset admits everyone.
    expect(poolSummary(0, 26)).toBe("все (26)");
  });

  it("counts a configured pool against the roster", () => {
    expect(poolSummary(5, 26)).toBe("5 из 26");
    expect(poolSummary(26, 26)).toBe("26 из 26");
  });
});

describe("toggleId", () => {
  it("adds somebody who isn't there and removes somebody who is", () => {
    expect(toggleId([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleId([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("never mutates the array it was given", () => {
    const before = [1, 2];
    toggleId(before, 3);
    expect(before).toEqual([1, 2]);
  });
});

describe("togglePreference", () => {
  it("turns a preference on with weight 1 and off by removing it", () => {
    expect(togglePreference({}, 4)).toEqual({ 4: 1 });
    expect(togglePreference({ 4: 1 }, 4)).toEqual({});
  });

  it("keeps a weight somebody else already has", () => {
    expect(togglePreference({ 7: 3 }, 4)).toEqual({ 7: 3, 4: 1 });
  });

  it("clears whatever the weight was, not just weight 1", () => {
    expect(togglePreference({ 4: 5 }, 4)).toEqual({});
  });

  it("never mutates the object it was given", () => {
    const before = { 4: 1 };
    togglePreference(before, 7);
    expect(before).toEqual({ 4: 1 });
  });
});

// The desktop console carries its own copy of these three helpers on purpose —
// the Mini App depends on neither the console nor its styles. The identical
// expectations live in admin/src/screens/shift-kinds.test.ts; if the two ever
// disagree, one of the two files starts failing.
