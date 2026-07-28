import { describe, it, expect } from "vitest";
import {
  parseBirthDate,
  isBirthDate,
  toBirthDate,
  formatBirthDate,
  daysUntilBirthday,
} from "./birthday";

describe("parseBirthDate", () => {
  it("reads a real day of a real month", () => {
    expect(parseBirthDate("08-05")).toEqual({ month: 8, day: 5 });
    expect(parseBirthDate("12-31")).toEqual({ month: 12, day: 31 });
    expect(parseBirthDate("01-01")).toEqual({ month: 1, day: 1 });
  });

  it("allows 29 February — it is a real birthday", () => {
    expect(parseBirthDate("02-29")).toEqual({ month: 2, day: 29 });
  });

  it("rejects a day that month hasn't got", () => {
    expect(parseBirthDate("02-30")).toBeNull();
    expect(parseBirthDate("04-31")).toBeNull();
    expect(parseBirthDate("06-31")).toBeNull();
  });

  it("rejects a month that doesn't exist, and anything not MM-DD", () => {
    for (const bad of ["13-01", "00-05", "08-00", "8-5", "2026-08-05", "05.08", "", "abc"]) {
      expect(parseBirthDate(bad), `«${bad}» must be rejected`).toBeNull();
    }
  });

  it("isBirthDate agrees with it", () => {
    expect(isBirthDate("08-05")).toBe(true);
    expect(isBirthDate("02-30")).toBe(false);
  });
});

describe("toBirthDate", () => {
  it("pads both parts", () => {
    expect(toBirthDate(8, 5)).toBe("08-05");
    expect(toBirthDate(12, 31)).toBe("12-31");
  });
});

describe("formatBirthDate", () => {
  it("writes it the way it is spoken", () => {
    expect(formatBirthDate("08-05")).toBe("5 августа");
    expect(formatBirthDate("01-01")).toBe("1 января");
    expect(formatBirthDate("02-29")).toBe("29 февраля");
  });

  it("hands back anything it cannot read, rather than inventing a date", () => {
    expect(formatBirthDate("13-40")).toBe("13-40");
  });
});

describe("daysUntilBirthday", () => {
  it("counts 0 on the day itself", () => {
    expect(daysUntilBirthday("08-05", "2026-08-05")).toBe(0);
  });

  it("counts forward inside the same year", () => {
    expect(daysUntilBirthday("08-05", "2026-07-29")).toBe(7);
    expect(daysUntilBirthday("12-31", "2026-12-01")).toBe(30);
  });

  it("rolls over to next year once it has passed — never a negative", () => {
    expect(daysUntilBirthday("01-01", "2026-12-31")).toBe(1);
    // 5 Aug 2026 -> 4 Aug 2027 is 364 days: neither year is a leap year.
    expect(daysUntilBirthday("08-04", "2026-08-05")).toBe(364);
  });

  it("greets somebody born on 29 February every year, not every fourth", () => {
    // 2027 is a common year: the occurrence lands on 1 March.
    expect(daysUntilBirthday("02-29", "2027-02-28")).toBe(1);
    // 2028 is a leap year, so it is the 29th itself.
    expect(daysUntilBirthday("02-29", "2028-02-28")).toBe(1);
    expect(daysUntilBirthday("02-29", "2028-02-29")).toBe(0);
  });

  it("counts a week ahead, which is when admins are told", () => {
    expect(daysUntilBirthday("08-12", "2026-08-05")).toBe(7);
  });

  it("returns null for an unreadable birthday or an unreadable day", () => {
    expect(daysUntilBirthday("02-30", "2026-08-05")).toBeNull();
    expect(daysUntilBirthday("08-05", "вчера")).toBeNull();
  });
});
