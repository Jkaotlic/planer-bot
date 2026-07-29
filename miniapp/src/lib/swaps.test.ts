import { describe, it, expect } from "vitest";
import type { SwapRequest } from "../api/client";
import { splitSwaps } from "./swaps";

const swap = (id: number, direction: SwapRequest["direction"], status: SwapRequest["status"]): SwapRequest => ({
  id,
  direction,
  status,
  message: null,
  createdAt: `2026-07-${String(id).padStart(2, "0")}T10:00:00.000Z`,
  counterpartyName: `Коллега ${id}`,
  yourShift: null,
  theirShift: null,
});

describe("splitSwaps", () => {
  it("keeps only what still needs an answer in the two live buckets", () => {
    const buckets = splitSwaps([
      swap(1, "incoming", "pending"),
      swap(2, "outgoing", "pending"),
      swap(3, "incoming", "accepted"),
      swap(4, "outgoing", "declined"),
    ]);
    expect(buckets.incoming.map((s) => s.id)).toEqual([1]);
    expect(buckets.outgoing.map((s) => s.id)).toEqual([2]);
  });

  it("archives every settled request from both sides", () => {
    // The hole this closes: a settled INCOMING request used to be visible
    // nowhere at all, so half the history was missing.
    const buckets = splitSwaps([
      swap(3, "incoming", "accepted"),
      swap(4, "outgoing", "declined"),
      swap(5, "incoming", "cancelled"),
      swap(6, "outgoing", "expired"),
    ]);
    expect(buckets.archived.map((s) => s.id)).toEqual([6, 5, 4, 3]);
    expect(buckets.incoming).toEqual([]);
    expect(buckets.outgoing).toEqual([]);
  });

  it("orders the archive newest first", () => {
    const buckets = splitSwaps([swap(3, "incoming", "accepted"), swap(9, "outgoing", "declined")]);
    expect(buckets.archived.map((s) => s.id)).toEqual([9, 3]);
  });

  it("handles an empty list", () => {
    expect(splitSwaps([])).toEqual({ incoming: [], outgoing: [], archived: [] });
  });
});
