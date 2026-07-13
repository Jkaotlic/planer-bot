import { describe, it, expect } from "vitest";
import { URLSearchParams } from "node:url";
import { signInitData, validateInitData } from "./telegram";

const BOT = "12345:test-token";
const NOW = 1_800_000_000;
const initDataFor = (over: Record<string, string> = {}) =>
  signInitData({ auth_date: String(NOW), user: JSON.stringify({ id: 555, first_name: "Аня", username: "anya" }), ...over }, BOT);

describe("validateInitData", () => {
  it("accepts a freshly signed initData and parses the user", () => {
    const res = validateInitData(initDataFor(), BOT, { nowSec: NOW });
    expect(res.user).toEqual({ id: 555, firstName: "Аня", lastName: undefined, username: "anya" });
    expect(res.authDate).toBe(NOW);
  });

  it("rejects data tampered after signing", () => {
    const params = new URLSearchParams(initDataFor());
    params.set("user", JSON.stringify({ id: 999 })); // change payload, keep old hash
    expect(() => validateInitData(params.toString(), BOT, { nowSec: NOW })).toThrow();
  });

  it("rejects a wrong bot token", () => {
    expect(() => validateInitData(initDataFor(), "999:other", { nowSec: NOW })).toThrow();
  });

  it("rejects expired initData", () => {
    expect(() => validateInitData(initDataFor(), BOT, { nowSec: NOW + 3600, maxAgeSec: 300 })).toThrow();
  });
});
