import { describe, it, expect } from "vitest";
import { addressOf, normalizePreferredName, PREFERRED_NAME_MAX } from "./address";

describe("addressOf", () => {
  it("uses the name the person gave Telegram", () => {
    expect(addressOf({ tgFirstName: "Андрей", displayName: "Петров Алексей" })).toBe("Андрей");
  });

  it("never says «Привет, Петров» — the roster's first word is the surname", () => {
    // The bug this module exists for: `displayName.split(" ")[0]` on a roster
    // written «Фамилия Имя» addresses people by surname alone.
    const address = addressOf({ tgFirstName: "Андрей", displayName: "Петров Алексей" });
    expect(address).not.toBe("Петров");
  });

  it("falls back to the full name rather than guessing which word is which", () => {
    // «Петров Алексей» and «Аня Смирнова» are the same shape with the parts the
    // other way round, so a guess is wrong half the time. Formal beats rude.
    expect(addressOf({ tgFirstName: null, displayName: "Петров Алексей" })).toBe("Петров Алексей");
    expect(addressOf({ displayName: "Аня Смирнова" })).toBe("Аня Смирнова");
  });

  it("treats a blank or whitespace Telegram name as absent", () => {
    expect(addressOf({ tgFirstName: "", displayName: "Петров Алексей" })).toBe("Петров Алексей");
    expect(addressOf({ tgFirstName: "   ", displayName: "Петров Алексей" })).toBe("Петров Алексей");
  });

  it("trims what Telegram gave us", () => {
    expect(addressOf({ tgFirstName: " Андрей ", displayName: "Петров Алексей" })).toBe("Андрей");
  });

  it("prefers the name the person chose over whatever Telegram has", () => {
    // The complaint this whole change exists for: his Telegram first name is
    // literally his surname in Latin.
    expect(addressOf({ preferredName: "Андрей", tgFirstName: "Petrov", displayName: "Петров Алексей" })).toBe("Андрей");
  });

  it("treats a blank chosen name as absent and falls through", () => {
    expect(addressOf({ preferredName: "   ", tgFirstName: "Кирилл", displayName: "Орлов Кирилл" })).toBe("Кирилл");
    expect(addressOf({ preferredName: null, tgFirstName: null, displayName: "Кузнецов Михаил" })).toBe("Кузнецов Михаил");
  });

  it("trims the chosen name", () => {
    expect(addressOf({ preferredName: " Андрей ", tgFirstName: null, displayName: "Петров Алексей" })).toBe("Андрей");
  });
});

describe("normalizePreferredName", () => {
  it("accepts a trimmed name", () => {
    expect(normalizePreferredName(" Андрей ")).toEqual({ ok: true, value: "Андрей" });
  });

  it("turns blank input into null, so «clear it» and «erase it» agree", () => {
    expect(normalizePreferredName("")).toEqual({ ok: true, value: null });
    expect(normalizePreferredName("   ")).toEqual({ ok: true, value: null });
    expect(normalizePreferredName(null)).toEqual({ ok: true, value: null });
  });

  it("rejects a non-string and an over-long name", () => {
    expect(normalizePreferredName(42)).toEqual({ ok: false });
    expect(normalizePreferredName("я".repeat(PREFERRED_NAME_MAX + 1))).toEqual({ ok: false });
  });

  it("accepts exactly the maximum", () => {
    const name = "я".repeat(PREFERRED_NAME_MAX);
    expect(normalizePreferredName(name)).toEqual({ ok: true, value: name });
  });
});
