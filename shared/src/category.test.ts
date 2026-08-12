import { describe, it, expect } from "vitest";
import {
  entryCategorySchema,
  isSwappable,
  isAbsence,
  categoryLabel,
  categoryAccusative,
  categoryPossessive,
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

  it("меняться можно сменами и дежурствами", () => {
    expect(ALL.filter(isSwappable)).toEqual(["shift", "duty"]);
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
    expect(categoryLabel("offsite")).toBe("Мероприятие");
    expect(categoryLabel("business_trip")).toBe("Командировка");
    expect(categoryLabel("weekend_work")).toBe("Работа в выходной");
  });
});

describe("склонения категорий для писем", () => {
  it("винительный падеж — то, что подставляется после «поставил(а) тебе»", () => {
    expect(categoryAccusative("shift")).toBe("смену");
    expect(categoryAccusative("duty")).toBe("дежурство");
    expect(categoryAccusative("vacation")).toBe("отпуск");
    expect(categoryAccusative("sick_leave")).toBe("больничный");
    expect(categoryAccusative("offsite")).toBe("мероприятие");
    expect(categoryAccusative("business_trip")).toBe("командировку");
    expect(categoryAccusative("weekend_work")).toBe("работу в выходной");
  });

  it("винительный с «твой» — род у категорий разный, одной формой не обойтись", () => {
    expect(categoryPossessive("shift")).toBe("твою смену");
    expect(categoryPossessive("duty")).toBe("твоё дежурство");
    expect(categoryPossessive("vacation")).toBe("твой отпуск");
    expect(categoryPossessive("sick_leave")).toBe("твой больничный");
    expect(categoryPossessive("offsite")).toBe("твоё мероприятие");
    expect(categoryPossessive("business_trip")).toBe("твою командировку");
    expect(categoryPossessive("weekend_work")).toBe("твою работу в выходной");
  });

  // Таблица, забытая при добавлении категории, — это письмо со словом `undefined`
  // в чате у человека. Перебор по схеме ловит это на наборе категорий, а не в проде.
  it("обе таблицы покрывают все категории, какие есть", () => {
    for (const category of entryCategorySchema.options) {
      expect(categoryAccusative(category)).toMatch(/\S/);
      expect(categoryPossessive(category)).toMatch(/\S/);
    }
  });
});
