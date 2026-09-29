import { describe, it, expect } from "vitest";
import { tallyShiftCounts, type TallyEntry, type TallyTemplate } from "./shift-counts";

const T: TallyTemplate[] = [
  { id: 1, name: "Утро", category: "shift", accent: "gold" },
  { id: 2, name: "День", category: "shift", accent: "blue" },
  { id: 3, name: "Ночь", category: "shift", accent: "indigo" },
  { id: 4, name: "Дежурство · Поклонка", category: "duty", accent: "teal" },
];
const PEOPLE = [{ id: 10, displayName: "Аня" }, { id: 11, displayName: "Игорь" }];
const e = (employeeId: number | null, templateId: number | null, extra: Partial<TallyEntry> = {}): TallyEntry =>
  ({ employeeId, templateId, category: "shift", title: null, ...extra });
const tally = (entries: TallyEntry[]) =>
  tallyShiftCounts({ from: "2026-06-01", to: "2026-06-30", entries, templates: T, employees: PEOPLE });

describe("tallyShiftCounts", () => {
  it("вид несёт группу по категории вида и его цвет", () => {
    const r = tally([e(10, 3), e(10, 4, { category: "duty" })]);
    expect(r.kinds).toEqual([
      { name: "Ночь", group: "shift", accent: "indigo" },
      { name: "Дежурство · Поклонка", group: "duty", accent: "teal" },
    ]);
  });

  it("итоги по группам вместо общего «Всего»", () => {
    const r = tally([e(10, 2), e(10, 3), e(10, 4, { category: "duty" }), e(10, null, { title: null })]);
    const anya = r.rows.find((x) => x.employeeId === 10)!;
    expect(anya.byGroup).toEqual({ shift: 2, duty: 1, other: 1 });
    expect(anya).not.toHaveProperty("total");
  });

  it("«Своё время» — «Прочее», хоть категория и «смена»: это не утро/день/вечер/ночь", () => {
    const r = tally([e(10, null)]);
    expect(r.kinds).toEqual([{ name: "Своё время", group: "other", accent: null }]);
  });

  it("запись без вида с категорией «дежурство» — в «Дежурства» под своим названием", () => {
    const r = tally([e(10, null, { category: "duty", title: "Дежурство · Старое место" })]);
    expect(r.kinds).toEqual([{ name: "Дежурство · Старое место", group: "duty", accent: null }]);
  });

  it("выход в выходной и выезд — «Прочее»", () => {
    const r = tally([e(10, null, { category: "weekend_work", title: "Выход" }), e(10, null, { category: "offsite", title: "Выезд" })]);
    expect(r.kinds.map((k) => k.group)).toEqual(["other", "other"]);
  });

  it("нераспознанная клетка — «Прочее» под своей меткой, не «Своё время»", () => {
    const r = tally([e(10, null, { unrecognisedCode: "Ко" })]);
    expect(r.kinds).toHaveLength(1);
    expect(r.kinds[0]!.group).toBe("other");
    expect(r.kinds[0]!.name).not.toBe("Своё время");
  });

  it("отсутствия не считаются и колонки не дают", () => {
    const r = tally([e(10, null, { category: "vacation" }), e(10, null, { category: "sick_leave" })]);
    expect(r.kinds).toEqual([]);
    expect(r.rows.find((x) => x.employeeId === 10)!.byGroup).toEqual({ shift: 0, duty: 0, other: 0 });
  });

  it("порядок: группы смены → дежурства → прочее, внутри — порядок пресетов, потом алфавит", () => {
    const r = tally([
      e(10, null, { title: "Яблоко" }),
      e(10, 4, { category: "duty" }),
      e(10, 3),
      e(10, null, { category: "duty", title: "Дежурство · Архив" }),
      e(10, 1),
    ]);
    expect(r.kinds.map((k) => k.name)).toEqual(["Утро", "Ночь", "Дежурство · Поклонка", "Дежурство · Архив", "Яблоко"]);
  });

  it("чужой (не в списке людей) и запись без человека не считаются", () => {
    const r = tally([e(99, 2), e(null, 2)]);
    expect(r.kinds).toEqual([]);
  });

  it("люди — в порядке списка, даже без смен", () => {
    expect(tally([]).rows.map((x) => x.displayName)).toEqual(["Аня", "Игорь"]);
  });
});
