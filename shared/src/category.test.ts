import { describe, it, expect } from "vitest";
import { entryCategorySchema, isSwappable, isAbsence, countsForBalance, type EntryCategory } from "./category";

const ALL: EntryCategory[] = ["shift", "vacation", "duty", "offsite", "business_trip", "weekend_work"];

describe("entry category", () => {
  it("validates the enum", () => {
    expect(entryCategorySchema.parse("shift")).toBe("shift");
    expect(entryCategorySchema.safeParse("bogus").success).toBe(false);
  });

  it("only regular shifts are swappable", () => {
    expect(ALL.filter(isSwappable)).toEqual(["shift"]);
  });

  it("absences are vacation and business_trip", () => {
    expect(ALL.filter(isAbsence)).toEqual(["vacation", "business_trip"]);
  });

  it("balance counts work, not absences", () => {
    expect(ALL.filter(countsForBalance)).toEqual(["shift", "duty", "offsite", "weekend_work"]);
  });
});
