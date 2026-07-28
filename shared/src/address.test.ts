import { describe, it, expect } from "vitest";
import { addressOf } from "./address";

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
});
