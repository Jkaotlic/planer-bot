import { describe, it, expect } from "vitest";
import { nextSwapStatus } from "./swap";

describe("nextSwapStatus", () => {
  it("moves pending → accepted on accept", () => {
    expect(nextSwapStatus("pending", "accept")).toBe("accepted");
  });

  it("moves pending → declined / cancelled / expired", () => {
    expect(nextSwapStatus("pending", "decline")).toBe("declined");
    expect(nextSwapStatus("pending", "cancel")).toBe("cancelled");
    expect(nextSwapStatus("pending", "expire")).toBe("expired");
  });

  it("throws when acting on an already-resolved request", () => {
    expect(() => nextSwapStatus("accepted", "accept")).toThrow();
    expect(() => nextSwapStatus("declined", "cancel")).toThrow();
    expect(() => nextSwapStatus("expired", "expire")).toThrow();
    expect(() => nextSwapStatus("cancelled", "decline")).toThrow();
  });
});
