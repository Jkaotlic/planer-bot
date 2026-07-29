import { describe, expect, it } from "vitest";
import { createLatestRequestGate } from "./request-gate";

describe("createLatestRequestGate", () => {
  it("accepts the first ticket it hands out as the latest", () => {
    const gate = createLatestRequestGate();
    const id = gate.begin();
    expect(gate.isLatest(id)).toBe(true);
  });

  it("makes an older ticket stale once a newer one is issued", () => {
    const gate = createLatestRequestGate();
    const first = gate.begin();
    const second = gate.begin();
    expect(gate.isLatest(first)).toBe(false);
    expect(gate.isLatest(second)).toBe(true);
  });

  it("resolves out of order without letting the older ticket win", () => {
    // Mirrors a slow first request finishing after a fast second one — the
    // scenario an admin triggers by tapping an action, then navigating away
    // before it settles.
    const gate = createLatestRequestGate();
    const slow = gate.begin();
    const fast = gate.begin();
    expect(gate.isLatest(fast)).toBe(true); // fast settles first, still latest
    expect(gate.isLatest(slow)).toBe(false); // slow settles after, must be ignored
  });

  it("supersedes every outstanding ticket on invalidate without minting one of its own", () => {
    const gate = createLatestRequestGate();
    const id = gate.begin();
    expect(gate.isLatest(id)).toBe(true);
    gate.invalidate();
    expect(gate.isLatest(id)).toBe(false);
    // invalidate() didn't hand out a ticket — a fresh begin() is still the new latest.
    const next = gate.begin();
    expect(gate.isLatest(next)).toBe(true);
  });
});
