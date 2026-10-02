import { describe, it, expect } from "vitest";
import {
  CoverageError,
  coverageAdviceText,
  coverageHint,
  coverageSummary,
  dayShortfallText,
  missingCoverage,
  normWeekday,
  parseCoverage,
  scheduleGaps,
  serializeCoverage,
  shortfallStatus,
  weekShortfall,
} from "./coverage";
import type { EntryCategory } from "./category";
import { EMPTY_CALENDAR, calendarFrom } from "./calendar";

describe("parseCoverage", () => {
  it("reads the verified Monday rule for Утро", () => {
    expect(parseCoverage("3,2,2,2,2,0,0")).toEqual([3, 2, 2, 2, 2, 0, 0]);
  });

  it("tolerates spaces around the numbers", () => {
    expect(parseCoverage(" 1, 0 ,0,0,0,0,0 ")).toEqual([1, 0, 0, 0, 0, 0, 0]);
  });

  it("rejects the wrong number of days", () => {
    expect(() => parseCoverage("1,1,1")).toThrow(/ровно 7/);
    expect(() => parseCoverage("1,1,1,1,1,1,1,1")).toThrow(/ровно 7/);
  });

  it("rejects everything Number() would silently accept", () => {
    for (const bad of ["", "1e3", "0x2", "-1", "1.5", "Infinity", "abc", " "]) {
      expect(() => parseCoverage(`${bad},0,0,0,0,0,0`), `coverage "${bad}" must be rejected`).toThrow(CoverageError);
    }
  });

  it("names the offending weekday so the editor can point at it", () => {
    expect(() => parseCoverage("1,1,-1,1,1,1,1")).toThrow(/день 3/);
  });
});

describe("serializeCoverage", () => {
  it("round-trips through parseCoverage", () => {
    const values = [3, 2, 2, 2, 2, 0, 0];
    expect(parseCoverage(serializeCoverage(values))).toEqual(values);
  });

  it("refuses to write a value it would refuse to read", () => {
    expect(() => serializeCoverage([1, 2, 3])).toThrow(/ровно 7/);
    expect(() => serializeCoverage([1, 1, 1, 1, 1, 1, -1])).toThrow(/день 7/);
    expect(() => serializeCoverage([1, 1, 1, 1, 1, 1, 1.5])).toThrow(/день 7/);
  });
});

const MORNING = { templateId: 10, name: "Утро", coverage: [2, 2, 2, 2, 2, 0, 0] };
const DUTY = { templateId: 20, name: "Дежурство · Поклонка", coverage: [1, 1, 1, 1, 1, 0, 0] };
const MONDAY = "2026-08-24";
const SUNDAY = "2026-08-23";

describe("missingCoverage", () => {
  it("считает нехватку по дню недели", () => {
    const entries = [{ date: MONDAY, employeeId: 1, templateId: 10 }];
    expect(missingCoverage(entries, [MORNING, DUTY], MONDAY, EMPTY_CALENDAR)).toEqual([
      { templateId: 10, name: "Утро", need: 2, have: 1 },
      { templateId: 20, name: "Дежурство · Поклонка", need: 1, have: 0 },
    ]);
  });

  it("молчит там, где норма нулевая", () => {
    // Воскресенье: норма 0 у обоих видов — это «не считаем», а не «не хватает всех».
    expect(missingCoverage([], [MORNING, DUTY], SUNDAY, EMPTY_CALENDAR)).toEqual([]);
  });

  it("закрытую норму не показывает", () => {
    const entries = [
      { date: MONDAY, employeeId: 1, templateId: 10 },
      { date: MONDAY, employeeId: 2, templateId: 10 },
    ];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)).toEqual([]);
  });

  it("пустой слот норму не закрывает", () => {
    // Строка в сетке без человека — это не вышедший на смену человек.
    const entries = [{ date: MONDAY, employeeId: null, templateId: 10 }];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)).toEqual([{ templateId: 10, name: "Утро", need: 2, have: 0 }]);
  });

  it("считает запись другого дня чужой", () => {
    const entries = [{ date: "2026-08-25", employeeId: 1, templateId: 10 }];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)[0]!.have).toBe(0);
  });

  it("считает запись другого вида смены чужой", () => {
    const entries = [{ date: MONDAY, employeeId: 1, templateId: 20 }];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)[0]!.have).toBe(0);
  });

  it("многодневная запись покрывает каждый свой день", () => {
    const entries = [{ date: "2026-08-20", endDate: "2026-08-26", employeeId: 1, templateId: 20 }];
    expect(missingCoverage(entries, [DUTY], MONDAY, EMPTY_CALENDAR)).toEqual([]);
  });

  it("один человек с двумя записями одного вида считается один раз", () => {
    // Иначе «Утро» закрывалось бы дважды одним человеком, и подсказка молчала бы
    // о дне, на который реально вышел один.
    const entries = [
      { date: MONDAY, employeeId: 1, templateId: 10 },
      { date: MONDAY, employeeId: 1, templateId: 10 },
    ];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)).toEqual([{ templateId: 10, name: "Утро", need: 2, have: 1 }]);
  });

  it("запись без вида смены не закрывает ничего", () => {
    // «Своё время» ставят руками, и к норме конкретного вида оно отношения не имеет.
    const entries = [{ date: MONDAY, employeeId: 1, templateId: null }];
    expect(missingCoverage(entries, [MORNING], MONDAY, EMPTY_CALENDAR)[0]!.have).toBe(0);
  });
});

describe("coverageSummary", () => {
  it("говорит, что норма не задана, когда всюду ноль", () => {
    expect(coverageSummary([0, 0, 0, 0, 0, 0, 0])).toBe("норма не задана");
  });

  it("перечисляет только дни с нормой", () => {
    expect(coverageSummary([2, 2, 2, 2, 2, 0, 0])).toBe("Пн 2 · Вт 2 · Ср 2 · Чт 2 · Пт 2");
  });

  it("не прячет разные числа за общим", () => {
    expect(coverageSummary([3, 2, 2, 2, 2, 0, 1])).toBe("Пн 3 · Вт 2 · Ср 2 · Чт 2 · Пт 2 · Вс 1");
  });
});

describe("coverageHint", () => {
  it("молчит, когда всё закрыто", () => {
    expect(coverageHint([])).toBeNull();
  });

  it("называет вид и сколько не хватает", () => {
    expect(coverageHint([
      { templateId: 10, name: "Утро", need: 2, have: 1 },
      { templateId: 20, name: "Дежурство · Поклонка", need: 1, have: 0 },
    ])).toBe("Не хватает: Утро — 1, Дежурство · Поклонка — 1");
  });

  it("считает разницу, а не норму", () => {
    expect(coverageHint([{ templateId: 10, name: "Утро", need: 3, have: 1 }])).toBe("Не хватает: Утро — 2");
  });
});

describe("dayShortfallText — строка дня в плашке нехватки", () => {
  const kind = (templateId: number, name: string, missing: number) => ({ templateId, name, need: missing, have: 0 });

  it("один и два вида — с разбивкой по видам", () => {
    expect(dayShortfallText([kind(1, "Утро", 1)])).toBe("Утро −1");
    expect(dayShortfallText([kind(1, "Утро", 1), kind(2, "День", 2)])).toBe("Утро −1, День −2");
  });

  it("больше двух видов — только итог дня", () => {
    expect(dayShortfallText([kind(1, "Утро", 9), kind(2, "День", 9), kind(3, "Вечер", 9)])).toBe("−27");
  });

  it("итог — сумма разниц, а не норм", () => {
    expect(dayShortfallText([
      { templateId: 1, name: "Утро", need: 3, have: 1 },
      { templateId: 2, name: "День", need: 2, have: 1 },
      { templateId: 3, name: "Вечер", need: 5, have: 0 },
    ])).toBe("−8");
  });

  it("нечего показывать — пустая строка", () => {
    expect(dayShortfallText([])).toBe("");
  });
});

describe("scheduleGaps — пробелы недели для совета админам", () => {
  // 2026-09-07 — понедельник; 2026-09-12 — суббота.
  const morning = { templateId: 1, name: "Утро", coverage: [2, 2, 2, 2, 2, 0, 0] };
  const duty = { templateId: 2, name: "Дежурство", coverage: [1, 1, 1, 1, 1, 0, 0] };
  const shift = (date: string, employeeId: number | null, templateId: number | null, category: EntryCategory = "shift") =>
    ({ date, employeeId, templateId, category });

  it("будний день без единой смены — пробел, даже если норм нет", () => {
    const gaps = scheduleGaps([], [], ["2026-09-07"], EMPTY_CALENDAR);
    expect(gaps).toEqual([{ date: "2026-09-07", missing: [], empty: true }]);
  });

  it("пустые суббота и воскресенье пробелом не считаются", () => {
    expect(scheduleGaps([], [], ["2026-09-12", "2026-09-13"], EMPTY_CALENDAR)).toEqual([]);
  });

  it("день ниже нормы — пробел с перечнем, чего не хватает", () => {
    const entries = [shift("2026-09-07", 10, 1), shift("2026-09-07", 11, 2)];
    const gaps = scheduleGaps(entries, [morning, duty], ["2026-09-07"], EMPTY_CALENDAR);
    expect(gaps).toEqual([
      { date: "2026-09-07", empty: false, missing: [{ templateId: 1, name: "Утро", need: 2, have: 1 }] },
    ]);
  });

  it("день по норме в ответ не попадает", () => {
    const entries = [shift("2026-09-07", 10, 1), shift("2026-09-07", 12, 1), shift("2026-09-07", 11, 2)];
    expect(scheduleGaps(entries, [morning, duty], ["2026-09-07"], EMPTY_CALENDAR)).toEqual([]);
  });

  it("отпуск и запись без человека день не заполняют", () => {
    const entries = [shift("2026-09-07", 10, null, "vacation"), shift("2026-09-07", null, 1)];
    expect(scheduleGaps(entries, [], ["2026-09-07"], EMPTY_CALENDAR)).toEqual([{ date: "2026-09-07", missing: [], empty: true }]);
  });

  it("праздник в будни пустым днём не считается, рабочая суббота — считается", () => {
    const cal = calendarFrom([{ date: "2026-09-07", kind: "holiday" }, { date: "2026-09-12", kind: "workday" }]);
    expect(scheduleGaps([], [], ["2026-09-07", "2026-09-12"], cal)).toEqual([{ date: "2026-09-12", missing: [], empty: true }]);
  });

  it("многодневное дежурство закрывает каждый свой день", () => {
    const entries = [{ date: "2026-09-07", endDate: "2026-09-11", employeeId: 11, templateId: 2, category: "duty" as const }];
    expect(scheduleGaps(entries, [], ["2026-09-07", "2026-09-08", "2026-09-11"], EMPTY_CALENDAR)).toEqual([]);
  });
});

describe("coverageAdviceText", () => {
  it("молчит, когда пробелов нет", () => {
    expect(coverageAdviceText([])).toBeNull();
  });

  it("называет день и что именно не так, по строке на день", () => {
    const text = coverageAdviceText([
      { date: "2026-09-09", missing: [], empty: true },
      { date: "2026-09-11", missing: [{ templateId: 1, name: "Утро", need: 2, have: 1 }], empty: false },
    ])!;
    expect(text).toContain("Ср 9 сентября — смен нет");
    expect(text).toContain("Пт 11 сентября — не хватает: Утро — 1");
    // Совет, а не тревога: так и подписан.
    expect(text).toMatch(/совет/i);
  });
});

describe("weekShortfall — нехватка недели одним ответом", () => {
  const WEEK = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
  const morning = { templateId: 10, name: "Утро", category: "shift" as const, coverage: [2, 0, 1, 0, 0, 0, 0] };
  const duty = { templateId: 20, name: "Дежурство", category: "duty" as const, coverage: [1, 0, 0, 0, 0, 0, 0] };

  it("закрытая неделя — ни дней, ни числа", () => {
    const entries = [
      { date: WEEK[0]!, employeeId: 1, templateId: 10 },
      { date: WEEK[0]!, employeeId: 2, templateId: 10 },
      { date: WEEK[2]!, employeeId: 1, templateId: 10 },
    ];
    expect(weekShortfall(entries, [morning], WEEK, EMPTY_CALENDAR)).toEqual({ days: [], total: 0, withoutNorm: [] });
  });

  it("отдаёт только дни с дырой и число людей по каждому", () => {
    const entries = [{ date: WEEK[0]!, employeeId: 1, templateId: 10 }];
    const result = weekShortfall(entries, [morning, duty], WEEK, EMPTY_CALENDAR);
    expect(result.days.map((day) => [day.date, day.short])).toEqual([[WEEK[0], 2], [WEEK[2], 1]]);
    expect(result.days[0]!.missing.map((kind) => kind.name)).toEqual(["Утро", "Дежурство"]);
  });

  it("итог недели — люди, а не дни", () => {
    // Понедельник: Утро −2 и Дежурство −1, среда: Утро −1. Дней два, людей четыре.
    expect(weekShortfall([], [morning, duty], WEEK, EMPTY_CALENDAR).total).toBe(4);
  });

  it("называет смены и дежурства, которым норму не задали", () => {
    const evening = { templateId: 30, name: "Вечер", category: "shift" as const, coverage: [0, 0, 0, 0, 0, 0, 0] };
    const night = { templateId: 40, name: "Ночное", category: "duty" as const, coverage: [0, 0, 0, 0, 0, 0, 0] };
    expect(weekShortfall([], [morning, evening, night], WEEK, EMPTY_CALENDAR).withoutNorm).toEqual([
      { templateId: 30, name: "Вечер" },
      { templateId: 40, name: "Ночное" },
    ]);
  });

  it("не требует нормы от того, что сменой не является", () => {
    // Отпуск и больничный — тоже пресеты, но «сколько людей нужно в отпуске»
    // вопроса не имеет.
    const vacation = { templateId: 50, name: "Отпуск", category: "vacation" as const, coverage: [0, 0, 0, 0, 0, 0, 0] };
    expect(weekShortfall([], [vacation], WEEK, EMPTY_CALENDAR).withoutNorm).toEqual([]);
  });

  it("не требует нормы от вида «все оставшиеся»", () => {
    // Он берёт всех, кого в этот день никуда не поставили: числа у него нет по смыслу.
    const rest = { templateId: 60, name: "Офис", category: "shift" as const, coverage: [0, 0, 0, 0, 0, 0, 0], fillMode: "remainder" as const };
    expect(weekShortfall([], [rest], WEEK, EMPTY_CALENDAR).withoutNorm).toEqual([]);
  });
});

describe("норма дня по календарю", () => {
  const morning = { templateId: 1, name: "Утро", coverage: [3, 2, 2, 2, 1, 0, 0] };
  const weekendDuty = { templateId: 9, name: "Резерв", coverage: [0, 0, 0, 0, 0, 1, 1] };

  it("обычный день — по своему дню недели", () => {
    expect(normWeekday("2026-11-04", EMPTY_CALENDAR)).toBe(2); // среда
  });

  it("праздник в среду считается по норме воскресенья", () => {
    const calendar = calendarFrom([{ date: "2026-11-04", kind: "holiday" }]);
    expect(normWeekday("2026-11-04", calendar)).toBe(6);
    expect(missingCoverage([], [morning, weekendDuty], "2026-11-04", calendar))
      .toEqual([{ templateId: 9, name: "Резерв", need: 1, have: 0 }]);
  });

  it("рабочая суббота считается по норме пятницы", () => {
    const calendar = calendarFrom([{ date: "2026-11-07", kind: "workday" }]);
    expect(normWeekday("2026-11-07", calendar)).toBe(4);
    expect(missingCoverage([], [morning, weekendDuty], "2026-11-07", calendar))
      .toEqual([{ templateId: 1, name: "Утро", need: 1, have: 0 }]);
  });

  it("weekShortfall и scheduleGaps считают праздник так же", () => {
    const calendar = calendarFrom([{ date: "2026-11-04", kind: "holiday" }]);
    expect(weekShortfall([], [{ ...morning, category: "shift" }], ["2026-11-04"], calendar).total).toBe(0);
    expect(scheduleGaps([], [morning], ["2026-11-04"], calendar)).toEqual([]);
  });
});

describe("shortfallStatus — состояние плашки над графиком", () => {
  const WEEK_DAYS = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
  const kind = (templateId: number, coverage: number[], category: EntryCategory = "shift", fillMode: "count" | "remainder" = "count") =>
    ({ templateId, name: `Вид ${templateId}`, coverage, category, fillMode });
  const status = (entries: Parameters<typeof weekShortfall>[0], templates: ReturnType<typeof kind>[]) =>
    shortfallStatus(weekShortfall(entries, templates, WEEK_DAYS, EMPTY_CALENDAR), templates);

  it("есть дыра — short", () => {
    expect(status([], [kind(1, [1, 0, 0, 0, 0, 0, 0])])).toEqual({ state: "short", unsetCount: 0 });
  });

  it("норма закрыта — closed", () => {
    const entries = [{ date: "2026-08-24", employeeId: 7, templateId: 1 }];
    expect(status(entries, [kind(1, [1, 0, 0, 0, 0, 0, 0])])).toEqual({ state: "closed", unsetCount: 0 });
  });

  it("closed помнит, сколько видов без нормы", () => {
    const entries = [{ date: "2026-08-24", employeeId: 7, templateId: 1 }];
    expect(status(entries, [kind(1, [1, 0, 0, 0, 0, 0, 0]), kind(2, [0, 0, 0, 0, 0, 0, 0], "duty")]))
      .toEqual({ state: "closed", unsetCount: 1 });
  });

  it("нормы нет ни у одного вида — no-norms, а не closed", () => {
    expect(status([], [kind(1, [0, 0, 0, 0, 0, 0, 0]), kind(2, [0, 0, 0, 0, 0, 0, 0], "duty")]))
      .toEqual({ state: "no-norms", unsetCount: 2 });
  });

  it("видов смен и дежурств нет вовсе — no-norms", () => {
    expect(status([], [kind(3, [0, 0, 0, 0, 0, 0, 0], "vacation")])).toEqual({ state: "no-norms", unsetCount: 0 });
  });

  it("вид «все оставшиеся» нормой не считается и в no-norms не мешает", () => {
    expect(status([], [kind(1, [0, 0, 0, 0, 0, 0, 0], "shift", "remainder")]).state).toBe("no-norms");
  });
});
