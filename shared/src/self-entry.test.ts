import { describe, it, expect } from "vitest";
import { entryCategorySchema } from "./category";
import { addDaysIso } from "./week-dates";
import {
  isSelfWritable,
  selfEntryRefusal,
  selfEntryEditRefusal,
  SICK_BACKDATE_DAYS,
  SELF_ENTRY_HORIZON_DAYS,
} from "./self-entry";

const TODAY = "2026-08-12";

/** Сдвиг от сегодня в днях — чтобы фикстуры читались, а не считались глазами. */
function day(offset: number): string {
  return addDaysIso(TODAY, offset);
}

describe("что работник может поставить себе сам", () => {
  it("ровно две категории из семи — остальное ведёт админ", () => {
    const writable = entryCategorySchema.options.filter(isSelfWritable);
    expect(writable).toEqual(["sick_leave", "offsite"]);
  });

  it("смену себе поставить нельзя", () => {
    expect(selfEntryRefusal({ category: "shift", date: TODAY }, TODAY)).not.toBeNull();
  });

  it("больничный задним числом можно ровно на семь дней", () => {
    expect(selfEntryRefusal({ category: "sick_leave", date: day(-SICK_BACKDATE_DAYS) }, TODAY)).toBeNull();
    expect(selfEntryRefusal({ category: "sick_leave", date: day(-SICK_BACKDATE_DAYS - 1) }, TODAY)).not.toBeNull();
  });

  it("мероприятие задним числом нельзя вовсе — передавать нечего, предупреждать некого", () => {
    expect(selfEntryRefusal({ category: "offsite", date: day(-1) }, TODAY)).not.toBeNull();
    expect(selfEntryRefusal({ category: "offsite", date: TODAY }, TODAY)).toBeNull();
  });

  it("дальше горизонта не пускает — там графика нет", () => {
    expect(selfEntryRefusal({ category: "offsite", date: day(SELF_ENTRY_HORIZON_DAYS) }, TODAY)).toBeNull();
    expect(selfEntryRefusal({ category: "offsite", date: day(SELF_ENTRY_HORIZON_DAYS + 1) }, TODAY)).not.toBeNull();
  });

  it("запись длиннее горизонта не пускает", () => {
    const draft = { category: "sick_leave" as const, date: TODAY, endDate: day(SELF_ENTRY_HORIZON_DAYS + 1) };
    expect(selfEntryRefusal(draft, TODAY)).not.toBeNull();
  });

  it("перевёрнутый диапазон — не наша забота, его ловит entryRangeError", () => {
    // Здесь важно, что правило про ПРАВА не выдумывает себе второй проверки
    // согласованности: она уже есть и живёт в одном месте.
    expect(selfEntryRefusal({ category: "sick_leave", date: TODAY, endDate: day(-3) }, TODAY)).toBeNull();
  });
});

describe("что работник может ещё править", () => {
  it("кончившуюся вчера — уже нет, это отчётность", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-3), endDate: day(-1) }, TODAY)).not.toBeNull();
  });

  it("кончающуюся сегодня — ещё да", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-3), endDate: TODAY }, TODAY)).toBeNull();
  });

  it("идущий больничный продлевается: граница считается по концу, а не по началу", () => {
    expect(selfEntryEditRefusal({ category: "sick_leave", date: day(-2), endDate: day(1) }, TODAY)).toBeNull();
  });

  it("чужую категорию не правит — даже свою собственную смену", () => {
    expect(selfEntryEditRefusal({ category: "shift", date: day(5) }, TODAY)).not.toBeNull();
  });
});
