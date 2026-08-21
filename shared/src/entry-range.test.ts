import { describe, expect, it } from "vitest";
import { describeEntryRangePlan, describeEntryRangeResult, planEntryRange } from "./entry-range";

/**
 * Правило «какие дни диапазона получат запись».
 *
 * Живёт в shared, потому что читателей двое: сервер — чтобы записать, консоли —
 * чтобы показать «поставится 18 дней» ДО сохранения. Посчитанное на экране и на
 * сервере разными кодами — это два разных правила через полгода.
 */
describe("planEntryRange", () => {
  // 2026-08-24 — понедельник, 2026-08-29/30 — суббота и воскресенье.
  const MON = "2026-08-24";
  const SUN = "2026-08-30";

  it("будни берёт, выходные пропускает с причиной", () => {
    const plan = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: false, busyDates: [] });
    expect(plan.days).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(plan.skipped).toEqual([
      { date: "2026-08-29", reason: "weekend" },
      { date: "2026-08-30", reason: "weekend" },
    ]);
  });

  it("с поднятым флагом берёт и выходные", () => {
    const plan = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: true, busyDates: [] });
    expect(plan.days).toHaveLength(7);
    expect(plan.skipped).toEqual([]);
  });

  // Правило самой категории, а не настройка формы: `entryDateError` откажет
  // «Работе в выходной» на будни, и день, который сервер всё равно не примет,
  // нельзя молча положить в список — он бы уронил всю транзакцию.
  it("«Работа в выходной» берёт только субботу и воскресенье, даже с флагом", () => {
    const plan = planEntryRange({ from: MON, to: SUN, category: "weekend_work", includeWeekends: true, busyDates: [] });
    expect(plan.days).toEqual(["2026-08-29", "2026-08-30"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["category", "category", "category", "category", "category"]);
  });

  it("занятый день пропускает, а не кладёт вторую смену поверх первой", () => {
    const plan = planEntryRange({
      from: MON, to: "2026-08-26", category: "shift", includeWeekends: false,
      busyDates: ["2026-08-25"],
    });
    expect(plan.days).toEqual(["2026-08-24", "2026-08-26"]);
    expect(plan.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
  });

  // Отсутствие в базе живёт одной записью с `endDate` — дробить его по дням
  // значило бы тридцать строк вместо одной и тридцать клеток вместо полосы.
  it("отсутствие отдаёт одним днём — записывать его будут диапазоном", () => {
    const plan = planEntryRange({
      from: MON, to: SUN, category: "vacation", includeWeekends: false,
      busyDates: ["2026-08-25"],
    });
    expect(plan.days).toEqual([MON]);
    expect(plan.skipped).toEqual([]);
  });

  it("перевёрнутый диапазон пуст, а не бесконечен", () => {
    const plan = planEntryRange({ from: SUN, to: MON, category: "shift", includeWeekends: true, busyDates: [] });
    expect(plan.days).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("один день — обычная запись, и никаких пропусков", () => {
    const plan = planEntryRange({ from: MON, to: MON, category: "duty", includeWeekends: false, busyDates: [] });
    expect(plan.days).toEqual([MON]);
    expect(plan.skipped).toEqual([]);
  });

  // Отдельно от «дежурство тоже берётся»: смена и дежурство обязаны считаться
  // одним правилом — в этом весь пункт 5 его списка.
  it("дежурство считается тем же правилом, что смена", () => {
    const shift = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: false, busyDates: [] });
    const duty = planEntryRange({ from: MON, to: SUN, category: "duty", includeWeekends: false, busyDates: [] });
    expect(duty).toEqual(shift);
  });
});

describe("describeEntryRangePlan", () => {
  it("без пропусков — только сколько поставлено", () => {
    expect(describeEntryRangePlan({ days: ["a", "b"], skipped: [] })).toBe("2 дня");
  });

  it("называет каждую причину своим числом", () => {
    const text = describeEntryRangePlan({
      days: ["a", "b", "c", "d", "e"],
      skipped: [
        { date: "x", reason: "weekend" }, { date: "y", reason: "weekend" },
        { date: "z", reason: "busy" },
      ],
    });
    expect(text).toBe("5 дней · пропущено 3: 2 выходных, 1 уже занят");
  });

  // Ноль дней — не «поставится», а «не поставится ничего»: кнопка «Сохранить»
  // на таком плане не должна выглядеть безобидной.
  it("пустой план говорит «0 дней», а не молчит", () => {
    expect(describeEntryRangePlan({ days: [], skipped: [{ date: "x", reason: "busy" }] }))
      .toBe("0 дней · пропущено 1: 1 уже занят");
  });
});

describe("describeEntryRangeResult", () => {
  it("считает поставленные дни, а не строки", () => {
    const text = describeEntryRangeResult({
      created: [{ date: "2026-08-24" }, { date: "2026-08-25" }],
      skipped: [{ date: "2026-08-29", reason: "weekend" }],
    });
    expect(text).toBe("Поставлено 2 дня · пропущено 1: 1 выходной");
  });

  // Недельный отпуск — одна строка в базе. «Поставлено 1 день» про него было бы
  // неправдой ровно там, где человек проверяет, что получилось.
  it("полосу отсутствия считает по сроку, а не по числу записей", () => {
    const text = describeEntryRangeResult({
      created: [{ date: "2026-08-24", endDate: "2026-08-30" }],
      skipped: [],
    });
    expect(text).toBe("Поставлено 7 дней");
  });
});
