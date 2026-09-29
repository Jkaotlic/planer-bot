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

  it("группа важнее порядка видов: дежурство, стоящее в списке первым, всё равно после смен", () => {
    const r = tallyShiftCounts({
      from: "2026-06-01", to: "2026-06-30", employees: PEOPLE,
      templates: [T[3]!, T[2]!], // «Дежурство · Поклонка» раньше «Ночи»
      entries: [e(10, 4, { category: "duty" }), e(10, 3)],
    });
    expect(r.kinds.map((k) => k.name)).toEqual(["Ночь", "Дежурство · Поклонка"]);
  });

  it("одно имя в двух группах — две колонки, и дежурство не теряется, в каком порядке ни шли бы записи", () => {
    for (const entries of [
      [e(10, null), e(11, null, { category: "duty" })],
      [e(11, null, { category: "duty" }), e(10, null)],
    ]) {
      const r = tally(entries);
      expect(r.rows.find((x) => x.employeeId === 11)!.byGroup).toEqual({ shift: 0, duty: 1, other: 0 });
      expect(r.rows.find((x) => x.employeeId === 10)!.byGroup).toEqual({ shift: 0, duty: 0, other: 1 });
      expect(new Set(r.kinds.map((k) => k.name)).size).toBe(2);
    }
  });

  it("смена упразднённого вида — всё ещё «Смены», а не «Прочее»", () => {
    // listActiveTemplates не отдаёт упразднённые виды, а записи на них остаются в
    // прошлых периодах: без этого правила итог «Смен» задним числом проседал бы.
    const r = tally([e(10, 99, { title: "Вечер" })]);
    expect(r.kinds).toEqual([{ name: "Вечер", group: "shift", accent: null }]);
  });

  it("вид с названием свойства объекта («constructor») считается числом, а не ломается", () => {
    const r = tally([e(10, null, { title: "constructor" }), e(10, null, { title: "constructor" })]);
    expect(r.rows.find((x) => x.employeeId === 10)!.byKind.constructor).toBe(2);
  });

  it("чужой (не в списке людей) и запись без человека не считаются", () => {
    const r = tally([e(99, 2), e(null, 2)]);
    expect(r.kinds).toEqual([]);
  });

  it("запись без вида с названием вида — это тот вид, в какой бы очерёдности ни шла", () => {
    // В проде такие есть: «День» без templateId (импорт, ручная запись). Без этого
    // правила группу колонке решала бы первая попавшаяся запись, и все «Дни»
    // уезжали бы в «Прочее».
    const r = tally([e(10, null, { title: "День" }), e(11, 2)]);
    expect(r.kinds).toEqual([{ name: "День", group: "shift", accent: "blue" }]);
    expect(r.rows.map((x) => x.byGroup.shift)).toEqual([1, 1]);
  });

  it("люди — в порядке списка, даже без смен", () => {
    expect(tally([]).rows.map((x) => x.displayName)).toEqual(["Аня", "Игорь"]);
  });
});
