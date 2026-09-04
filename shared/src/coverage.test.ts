import { describe, it, expect } from "vitest";
import {
  CoverageError,
  coverageAdviceText,
  coverageHint,
  coverageSummary,
  missingCoverage,
  parseCoverage,
  scheduleGaps,
  serializeCoverage,
} from "./coverage";
import type { EntryCategory } from "./category";

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
    expect(missingCoverage(entries, [MORNING, DUTY], MONDAY)).toEqual([
      { templateId: 10, name: "Утро", need: 2, have: 1 },
      { templateId: 20, name: "Дежурство · Поклонка", need: 1, have: 0 },
    ]);
  });

  it("молчит там, где норма нулевая", () => {
    // Воскресенье: норма 0 у обоих видов — это «не считаем», а не «не хватает всех».
    expect(missingCoverage([], [MORNING, DUTY], SUNDAY)).toEqual([]);
  });

  it("закрытую норму не показывает", () => {
    const entries = [
      { date: MONDAY, employeeId: 1, templateId: 10 },
      { date: MONDAY, employeeId: 2, templateId: 10 },
    ];
    expect(missingCoverage(entries, [MORNING], MONDAY)).toEqual([]);
  });

  it("пустой слот норму не закрывает", () => {
    // Строка в сетке без человека — это не вышедший на смену человек.
    const entries = [{ date: MONDAY, employeeId: null, templateId: 10 }];
    expect(missingCoverage(entries, [MORNING], MONDAY)).toEqual([{ templateId: 10, name: "Утро", need: 2, have: 0 }]);
  });

  it("считает запись другого дня чужой", () => {
    const entries = [{ date: "2026-08-25", employeeId: 1, templateId: 10 }];
    expect(missingCoverage(entries, [MORNING], MONDAY)[0]!.have).toBe(0);
  });

  it("считает запись другого вида смены чужой", () => {
    const entries = [{ date: MONDAY, employeeId: 1, templateId: 20 }];
    expect(missingCoverage(entries, [MORNING], MONDAY)[0]!.have).toBe(0);
  });

  it("многодневная запись покрывает каждый свой день", () => {
    const entries = [{ date: "2026-08-20", endDate: "2026-08-26", employeeId: 1, templateId: 20 }];
    expect(missingCoverage(entries, [DUTY], MONDAY)).toEqual([]);
  });

  it("один человек с двумя записями одного вида считается один раз", () => {
    // Иначе «Утро» закрывалось бы дважды одним человеком, и подсказка молчала бы
    // о дне, на который реально вышел один.
    const entries = [
      { date: MONDAY, employeeId: 1, templateId: 10 },
      { date: MONDAY, employeeId: 1, templateId: 10 },
    ];
    expect(missingCoverage(entries, [MORNING], MONDAY)).toEqual([{ templateId: 10, name: "Утро", need: 2, have: 1 }]);
  });

  it("запись без вида смены не закрывает ничего", () => {
    // «Своё время» ставят руками, и к норме конкретного вида оно отношения не имеет.
    const entries = [{ date: MONDAY, employeeId: 1, templateId: null }];
    expect(missingCoverage(entries, [MORNING], MONDAY)[0]!.have).toBe(0);
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

describe("scheduleGaps — пробелы недели для совета админам", () => {
  // 2026-09-07 — понедельник; 2026-09-12 — суббота.
  const morning = { templateId: 1, name: "Утро", coverage: [2, 2, 2, 2, 2, 0, 0] };
  const duty = { templateId: 2, name: "Дежурство", coverage: [1, 1, 1, 1, 1, 0, 0] };
  const shift = (date: string, employeeId: number | null, templateId: number | null, category: EntryCategory = "shift") =>
    ({ date, employeeId, templateId, category });

  it("будний день без единой смены — пробел, даже если норм нет", () => {
    const gaps = scheduleGaps([], [], ["2026-09-07"]);
    expect(gaps).toEqual([{ date: "2026-09-07", missing: [], empty: true }]);
  });

  it("пустые суббота и воскресенье пробелом не считаются", () => {
    expect(scheduleGaps([], [], ["2026-09-12", "2026-09-13"])).toEqual([]);
  });

  it("день ниже нормы — пробел с перечнем, чего не хватает", () => {
    const entries = [shift("2026-09-07", 10, 1), shift("2026-09-07", 11, 2)];
    const gaps = scheduleGaps(entries, [morning, duty], ["2026-09-07"]);
    expect(gaps).toEqual([
      { date: "2026-09-07", empty: false, missing: [{ templateId: 1, name: "Утро", need: 2, have: 1 }] },
    ]);
  });

  it("день по норме в ответ не попадает", () => {
    const entries = [shift("2026-09-07", 10, 1), shift("2026-09-07", 12, 1), shift("2026-09-07", 11, 2)];
    expect(scheduleGaps(entries, [morning, duty], ["2026-09-07"])).toEqual([]);
  });

  it("отпуск и запись без человека день не заполняют", () => {
    const entries = [shift("2026-09-07", 10, null, "vacation"), shift("2026-09-07", null, 1)];
    expect(scheduleGaps(entries, [], ["2026-09-07"])).toEqual([{ date: "2026-09-07", missing: [], empty: true }]);
  });

  it("многодневное дежурство закрывает каждый свой день", () => {
    const entries = [{ date: "2026-09-07", endDate: "2026-09-11", employeeId: 11, templateId: 2, category: "duty" as const }];
    expect(scheduleGaps(entries, [], ["2026-09-07", "2026-09-08", "2026-09-11"])).toEqual([]);
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
