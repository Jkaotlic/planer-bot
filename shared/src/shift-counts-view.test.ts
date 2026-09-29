import { describe, it, expect } from "vitest";
import type { ShiftCountsRow } from "./shift-counts";
import {
  groupKinds, sortCountsRows, heatLevel, heatBackground, rankByKey, countsPeriodPresets, countsValue, countsKeyLabel,
} from "./shift-counts-view";

const row = (employeeId: number, displayName: string, byKind: Record<string, number>, byGroup: Partial<ShiftCountsRow["byGroup"]> = {}): ShiftCountsRow =>
  ({ employeeId, displayName, byKind, byGroup: { shift: 0, duty: 0, other: 0, ...byGroup } });

describe("groupKinds", () => {
  it("группы в порядке смены → дежурства → прочее, пустых нет", () => {
    const g = groupKinds([
      { name: "Своё время", group: "other", accent: null },
      { name: "Ночь", group: "shift", accent: "indigo" },
    ]);
    expect(g.map((x) => [x.group, x.title, x.kinds.map((k) => k.name)])).toEqual([
      ["shift", "Смены", ["Ночь"]],
      ["other", "Прочее", ["Своё время"]],
    ]);
  });
});

describe("sortCountsRows", () => {
  const rows = [
    row(1, "Марк", { Ночь: 2 }, { shift: 2 }),
    row(2, "Аня", { Ночь: 2 }, { shift: 2, duty: 1 }),
    row(3, "Игорь", { Ночь: 5 }, { shift: 5 }),
    row(4, "Лена", {}, {}),
  ];
  it("по виду по убыванию, при равенстве — по имени; нулевые во всём отброшены", () => {
    expect(sortCountsRows(rows, { kind: "Ночь" }, "desc").map((r) => r.displayName)).toEqual(["Игорь", "Аня", "Марк"]);
  });
  it("по итогу группы по возрастанию", () => {
    expect(sortCountsRows(rows, { group: "duty" }, "asc").map((r) => r.displayName)).toEqual(["Игорь", "Марк", "Аня"]);
  });
  it("по имени", () => {
    expect(sortCountsRows(rows, "name", "asc").map((r) => r.displayName)).toEqual(["Аня", "Игорь", "Марк"]);
  });
});

describe("heatLevel", () => {
  it("ноль — 0, максимум — 4, середина — ступенью", () => {
    expect(heatLevel(0, 10)).toBe(0);
    expect(heatLevel(10, 10)).toBe(4);
    expect(heatLevel(1, 10)).toBe(1);
    expect(heatLevel(5, 10)).toBe(2);
    expect(heatLevel(7, 10)).toBe(3);
  });
  it("все по одной — единица это максимум, а не деление на ноль", () => {
    expect(heatLevel(1, 1)).toBe(4);
    expect(heatLevel(0, 0)).toBe(0);
  });
});

describe("heatBackground", () => {
  it("ноль прозрачен, ступени — rgba (color-mix не открывается на iOS 14)", () => {
    expect(heatBackground("duty", 0)).toBe("transparent");
    expect(heatBackground("duty", 4)).toMatch(/^rgba\(/);
    expect(heatBackground("duty", 4)).not.toBe(heatBackground("shift", 4));
    expect(heatBackground("duty", 1)).not.toBe(heatBackground("duty", 4));
  });
});

describe("rankByKey", () => {
  it("только ненулевые, по убыванию, доля от максимума", () => {
    // byGroup согласован с byKind, как в настоящем отчёте: строка с нулём во всех
    // группах отбрасывается как «без смен».
    const rows = [row(1, "Марк", { Ночь: 2 }, { shift: 2 }), row(2, "Аня", { Ночь: 4 }, { shift: 4 }), row(3, "Игорь", { Утро: 1 }, { shift: 1 })];
    expect(rankByKey(rows, { kind: "Ночь" }).map((r) => [r.row.displayName, r.value, r.share])).toEqual([
      ["Аня", 4, 1],
      ["Марк", 2, 0.5],
    ]);
  });
});

describe("countsValue / countsKeyLabel", () => {
  it("вид и группа", () => {
    const r = row(1, "Аня", { Ночь: 3 }, { duty: 2 });
    expect(countsValue(r, { kind: "Ночь" })).toBe(3);
    expect(countsValue(r, { kind: "Утро" })).toBe(0);
    expect(countsValue(r, { group: "duty" })).toBe(2);
    expect(countsKeyLabel({ group: "duty" })).toBe("Все дежурства");
    expect(countsKeyLabel({ kind: "Ночь" })).toBe("Ночь");
  });
});

describe("countsPeriodPresets", () => {
  it("этот месяц, прошлый, квартал", () => {
    expect(countsPeriodPresets("2026-09-29")).toEqual([
      { label: "Этот месяц", from: "2026-09-01", to: "2026-09-30" },
      { label: "Прошлый месяц", from: "2026-08-01", to: "2026-08-31" },
      { label: "Квартал", from: "2026-07-01", to: "2026-09-30" },
    ]);
  });
  it("в январе прошлый месяц — декабрь прошлого года", () => {
    expect(countsPeriodPresets("2027-01-10")[1]).toEqual({ label: "Прошлый месяц", from: "2026-12-01", to: "2026-12-31" });
    expect(countsPeriodPresets("2027-01-10")[2]).toEqual({ label: "Квартал", from: "2027-01-01", to: "2027-03-31" });
  });
});
