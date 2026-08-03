import { describe, it, expect } from "vitest";
import {
  entryCategorySchema,
  isSwappable,
  isAbsence,
  categoryLabel,
  countsForBalance,
  templateAccents,
  type EntryCategory,
} from "./category";

const ALL: EntryCategory[] = ["shift", "vacation", "sick_leave", "duty", "offsite", "business_trip", "weekend_work"];

describe("entry category", () => {
  it("validates the enum", () => {
    expect(entryCategorySchema.parse("shift")).toBe("shift");
    expect(entryCategorySchema.safeParse("bogus").success).toBe(false);
  });

  it("only regular shifts are swappable", () => {
    expect(ALL.filter(isSwappable)).toEqual(["shift"]);
  });

  it("absences are vacation, sick leave and business_trip", () => {
    expect(ALL.filter(isAbsence)).toEqual(["vacation", "sick_leave", "business_trip"]);
  });

  it("sick leave is an absence: not swappable, not counted toward balance", () => {
    expect(entryCategorySchema.parse("sick_leave")).toBe("sick_leave");
    expect(isAbsence("sick_leave")).toBe(true);
    expect(isSwappable("sick_leave")).toBe(false);
    expect(countsForBalance("sick_leave")).toBe(false);
  });

  it("balance counts work, not absences", () => {
    expect(ALL.filter(countsForBalance)).toEqual(["shift", "duty", "offsite", "weekend_work"]);
  });
});

describe("templateAccents", () => {
  it("has a distinct colour slot for every preset", () => {
    expect(templateAccents).toEqual(["gold", "blue", "violet", "indigo", "teal", "green", "rose", "amber", "emerald"]);
    expect(new Set(templateAccents).size).toBe(templateAccents.length);
  });
});

describe("categoryLabel", () => {
  it("называет каждую категорию по-русски", () => {
    expect(categoryLabel("shift")).toBe("Смена");
    expect(categoryLabel("vacation")).toBe("Отпуск");
    expect(categoryLabel("sick_leave")).toBe("Больничный");
    expect(categoryLabel("duty")).toBe("Дежурство");
    expect(categoryLabel("offsite")).toBe("Выездное мероприятие");
    expect(categoryLabel("business_trip")).toBe("Командировка");
    expect(categoryLabel("weekend_work")).toBe("Работа в выходной");
  });
});
