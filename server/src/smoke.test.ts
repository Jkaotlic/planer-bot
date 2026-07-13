import { describe, it, expect } from "vitest";
import { z } from "zod";

describe("server workspace smoke", () => {
  it("has its dependencies wired", () => {
    expect(typeof z.object).toBe("function");
  });
});
