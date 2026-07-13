import { describe, it, expect } from "vitest";
import { issueToken, verifyToken } from "./jwt";

const SECRET = "test-secret-at-least-16-chars";

describe("jwt", () => {
  it("round-trips claims", async () => {
    const token = await issueToken({ employeeId: 7, isAdmin: true }, SECRET);
    expect(await verifyToken(token, SECRET)).toEqual({ employeeId: 7, isAdmin: true });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await issueToken({ employeeId: 7, isAdmin: false }, SECRET);
    await expect(verifyToken(token, "another-secret-16chars")).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const past = 1_000_000_000; // 2001 — exp = past + 60
    const token = await issueToken({ employeeId: 7, isAdmin: false }, SECRET, 60, past);
    await expect(verifyToken(token, SECRET)).rejects.toThrow();
  });
});
