import { describe, it, expect } from "vitest";
import { SignJWT } from "jose";
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

  it("rejects a token that isn't HS256 (algorithm pinning)", async () => {
    const key = new TextEncoder().encode(SECRET);
    const token = await new SignJWT({ employeeId: 7, isAdmin: true })
      .setProtectedHeader({ alg: "HS384" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(key);
    await expect(verifyToken(token, SECRET)).rejects.toThrow();
  });
});
