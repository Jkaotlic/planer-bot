import { describe, it, expect } from "vitest";
import { buildWeekLegend, buildWeekModel, splitDisplayName, type ScheduleEntryLike, type SchedulePresetLike } from "./week-model";

const MONDAY = "2026-08-03";

const PRESETS: SchedulePresetLike[] = [
  { id: 1, name: "День", accent: "blue", sortOrder: 1 },
  { id: 2, name: "Ночь", accent: "indigo", sortOrder: 2 },
];

function entry(over: Partial<ScheduleEntryLike> & { date: string }): ScheduleEntryLike {
  return {
    employeeId: 1,
    endDate: null,
    start: "08:00",
    end: "20:00",
    category: "shift",
    title: null,
    templateId: 1,
    unrecognisedCode: null,
    ...over,
  };
}

const TEAM = [
  { id: 1, displayName: "Иванов Иван", rosterOrder: 0 },
  { id: 2, displayName: "Петров Пётр", rosterOrder: 1 },
];

describe("модель недели", () => {
  it("строит семь дней от понедельника", () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [] }, PRESETS);
    expect(model.days).toEqual([
      "2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06",
      "2026-08-07", "2026-08-08", "2026-08-09",
    ]);
  });

  it("даёт по строке на человека в порядке ростера", () => {
    const model = buildWeekModel(MONDAY, { employees: [TEAM[1]!, TEAM[0]!], shifts: [] }, PRESETS);
    expect(model.rows.map((row) => row.displayName)).toEqual(["Иванов Иван", "Петров Пётр"]);
  });

  it("кладёт запись в свою клетку и берёт цвет пресета", () => {
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [entry({ date: "2026-08-05" })] }, PRESETS);
    const cell = model.rows[0]!.cells[2]!;
    expect(cell.primary?.palette?.code).toBe("Д");
    expect(cell.primary?.title).toBe("День");
    expect(model.rows[0]!.cells[0]!.primary).toBeNull();
  });

  it("растягивает многодневный отпуск на все его дни", () => {
    const vacation = entry({
      date: "2026-08-04", endDate: "2026-08-06", start: null, end: null,
      category: "vacation", templateId: null,
    });
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts: [vacation] }, PRESETS);
    const codes = model.rows[0]!.cells.map((cell) => cell.primary?.palette?.code ?? null);
    expect(codes).toEqual([null, "О", "О", "О", null, null, null]);
  });

  it("вторая запись в клетке уходит в +N", () => {
    const shifts = [entry({ date: "2026-08-03" }), entry({ date: "2026-08-03", templateId: 2, start: "20:00", end: "08:00" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const cell = model.rows[0]!.cells[0]!;
    expect(cell.primary?.palette?.code).toBe("Д"); // раньше по времени
    expect(cell.extraCount).toBe(1);
  });

  it("строка «Не назначено» появляется только когда есть ничейная смена", () => {
    const без = buildWeekModel(MONDAY, { employees: TEAM, shifts: [] }, PRESETS);
    expect(без.rows.map((row) => row.employeeId)).toEqual([1, 2]);

    const с = buildWeekModel(
      MONDAY,
      { employees: TEAM, shifts: [entry({ date: "2026-08-05", employeeId: null })] },
      PRESETS,
    );
    expect(с.rows.at(-1)!.employeeId).toBeNull();
    expect(с.rows.at(-1)!.displayName).toBe("Не назначено");
  });

  it("нераспознанная клетка говорит об этом словами и своим серым", () => {
    const shifts = [entry({ date: "2026-08-03", templateId: null, unrecognisedCode: "Ко" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const view = model.rows[0]!.cells[0]!.primary!;
    expect(view.palette?.code).toBe("?");
    expect(view.title).toContain("Ко");
  });

  it("легенда перечисляет только те буквы, что нарисованы", () => {
    const shifts = [entry({ date: "2026-08-03" }), entry({ date: "2026-08-04" })];
    const model = buildWeekModel(MONDAY, { employees: TEAM, shifts }, PRESETS);
    const legend = buildWeekLegend(model);
    expect(legend).toHaveLength(1);
    expect(legend[0]!.code).toBe("Д");
    expect(legend[0]!.label).toBe("День");
  });

  it("splitDisplayName отделяет фамилию от остального", () => {
    expect(splitDisplayName("Иванов Иван Иванович")).toEqual({ surname: "Иванов", rest: "Иван Иванович" });
    expect(splitDisplayName("Иванов")).toEqual({ surname: "Иванов", rest: "" });
  });
});
