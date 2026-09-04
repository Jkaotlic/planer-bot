import { describe, expect, it } from "vitest";
import { categoryFitsDate, describeEntryRangePlan, describeEntryRangeResult, entryRangeHint, planEntryRange } from "./entry-range";
import { EMPTY_CALENDAR, calendarFrom } from "./calendar";

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
    const plan = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: false, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(plan.days).toEqual(["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(plan.skipped).toEqual([
      { date: "2026-08-29", reason: "weekend" },
      { date: "2026-08-30", reason: "weekend" },
    ]);
  });

  it("с поднятым флагом берёт и выходные", () => {
    const plan = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: true, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(plan.days).toHaveLength(7);
    expect(plan.skipped).toEqual([]);
  });

  // Правило самой категории, а не настройка формы: `entryDateError` откажет
  // «Работе в выходной» на будни, и день, который сервер всё равно не примет,
  // нельзя молча положить в список — он бы уронил всю транзакцию.
  it("«Работа в выходной» берёт только субботу и воскресенье, даже с флагом", () => {
    const plan = planEntryRange({ from: MON, to: SUN, category: "weekend_work", includeWeekends: true, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(plan.days).toEqual(["2026-08-29", "2026-08-30"]);
    expect(plan.skipped.map((s) => s.reason)).toEqual(["category", "category", "category", "category", "category"]);
  });

  it("занятый день пропускает, а не кладёт вторую смену поверх первой", () => {
    const plan = planEntryRange({
      from: MON, to: "2026-08-26", category: "shift", includeWeekends: false,
      mode: "fill", occupied: { "2026-08-25": "work" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual(["2026-08-24", "2026-08-26"]);
    expect(plan.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
  });

  // Отсутствие в базе живёт одной записью с `endDate` — дробить его по дням
  // значило бы тридцать строк вместо одной и тридцать клеток вместо полосы.
  it("отсутствие отдаёт одним днём — записывать его будут диапазоном", () => {
    const plan = planEntryRange({
      from: MON, to: SUN, category: "vacation", includeWeekends: false,
      mode: "fill", occupied: { "2026-08-25": "work" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON]);
    expect(plan.skipped).toEqual([]);
  });

  it("перевёрнутый диапазон пуст, а не бесконечен", () => {
    const plan = planEntryRange({ from: SUN, to: MON, category: "shift", includeWeekends: true, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(plan.days).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("один день — обычная запись, и никаких пропусков", () => {
    const plan = planEntryRange({ from: MON, to: MON, category: "duty", includeWeekends: false, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(plan.days).toEqual([MON]);
    expect(plan.skipped).toEqual([]);
  });

  // Отдельно от «дежурство тоже берётся»: смена и дежурство обязаны считаться
  // одним правилом — в этом весь пункт 5 его списка.
  it("дежурство считается тем же правилом, что смена", () => {
    const shift = planEntryRange({ from: MON, to: SUN, category: "shift", includeWeekends: false, mode: "fill", calendar: EMPTY_CALENDAR });
    const duty = planEntryRange({ from: MON, to: SUN, category: "duty", includeWeekends: false, mode: "fill", calendar: EMPTY_CALENDAR });
    expect(duty).toEqual(shift);
  });
});

describe("describeEntryRangePlan", () => {
  it("без пропусков — только сколько поставлено", () => {
    expect(describeEntryRangePlan({ days: ["a", "b"], rewritten: [], skipped: [] })).toBe("2 дня");
  });

  it("называет каждую причину своим числом", () => {
    const text = describeEntryRangePlan({
      days: ["a", "b", "c", "d", "e"],
      rewritten: [],
      skipped: [
        { date: "x", reason: "weekend" }, { date: "y", reason: "weekend" },
        { date: "z", reason: "busy" },
      ],
    });
    expect(text).toBe("5 дней · пропущено 3: 2 выходных, 1 уже занят");
  });

  // Перезапись — необратимая операция, и её число человек обязан увидеть ДО
  // нажатия: «поставится 5 дней» про неделю, где четыре смены будут стёрты, —
  // правда, которая читается как неправда.
  it("называет, сколько дней перепишется", () => {
    const text = describeEntryRangePlan({
      days: ["a", "b", "c"], rewritten: ["a", "b"], skipped: [],
    });
    expect(text).toBe("3 дня · 2 перепишутся");
  });

  it("один переписанный день — единственное число", () => {
    expect(describeEntryRangePlan({ days: ["a"], rewritten: ["a"], skipped: [] })).toBe("1 день · 1 перепишется");
  });

  it("отсутствие и двойной день называет по-разному — иначе непонятно, что делать дальше", () => {
    const text = describeEntryRangePlan({
      days: ["a"], rewritten: [],
      skipped: [
        { date: "x", reason: "absence" }, { date: "y", reason: "absence" },
        { date: "z", reason: "ambiguous" },
      ],
    });
    expect(text).toBe("1 день · пропущено 3: 2 дня отсутствия, 1 день с двумя записями");
  });

  // Ноль дней — не «поставится», а «не поставится ничего»: кнопка «Сохранить»
  // на таком плане не должна выглядеть безобидной.
  it("пустой план говорит «0 дней», а не молчит", () => {
    expect(describeEntryRangePlan({ days: [], rewritten: [], skipped: [{ date: "x", reason: "busy" }] }))
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

  // Итог называет перезапись отдельно от появления: «поставлено 5» про неделю,
  // где четыре смены заменены, скрывает ровно то, что админ пришёл проверить.
  it("переписанные дни называет отдельно от новых", () => {
    const text = describeEntryRangeResult({
      created: [{ date: "2026-08-24" }],
      updated: [{ date: "2026-08-25" }, { date: "2026-08-26" }],
      skipped: [],
    });
    expect(text).toBe("Поставлено 3 дня · 2 переписано");
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

/**
 * Режим перезаписи: «сделай так на всём отрезке».
 *
 * Отличается от расстановки ровно одним — занятый рабочий день не пропускается,
 * а переписывается. Отсутствие остаётся неприкосновенным: снести человеку
 * отпуск одним движением, без отмены, — не та операция, которую можно сделать
 * побочным эффектом смены пресета.
 */
describe("planEntryRange в режиме перезаписи", () => {
  const MON = "2026-08-24";
  const WED = "2026-08-26";

  it("занятый рабочий день переписывает, а не пропускает", () => {
    const plan = planEntryRange({
      from: MON, to: WED, category: "duty", includeWeekends: false, mode: "rewrite",
      occupied: { "2026-08-25": "work" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON, "2026-08-25", WED]);
    expect(plan.rewritten).toEqual(["2026-08-25"]);
    expect(plan.skipped).toEqual([]);
  });

  it("отпуск не трогает и называет причину", () => {
    const plan = planEntryRange({
      from: MON, to: WED, category: "duty", includeWeekends: false, mode: "rewrite",
      occupied: { "2026-08-25": "absence" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON, WED]);
    expect(plan.skipped).toEqual([{ date: "2026-08-25", reason: "absence" }]);
  });

  // Уникального индекса на (работник, день) в таблице нет, и импорт ростера
  // такие дни создаёт. Какую из двух записей переписывать — знать неоткуда,
  // и догадка здесь дороже пропуска.
  it("день с двумя записями пропускает: какую из них переписывать — неизвестно", () => {
    const plan = planEntryRange({
      from: MON, to: WED, category: "duty", includeWeekends: false, mode: "rewrite",
      occupied: { "2026-08-25": "ambiguous" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON, WED]);
    expect(plan.skipped).toEqual([{ date: "2026-08-25", reason: "ambiguous" }]);
  });

  it("свободный день заполняет — перезапись не только про занятые", () => {
    const plan = planEntryRange({
      from: MON, to: WED, category: "duty", includeWeekends: false, mode: "rewrite", occupied: {},
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON, "2026-08-25", WED]);
    expect(plan.rewritten).toEqual([]);
  });

  // Выходные и правило вида сильнее режима: суббота без флага не берётся ни
  // при расстановке, ни при перезаписи, даже если в ней что-то стоит.
  it("выходной без флага не переписывает", () => {
    const plan = planEntryRange({
      from: "2026-08-29", to: "2026-08-29", category: "duty", includeWeekends: false, mode: "rewrite",
      occupied: { "2026-08-29": "work" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([]);
    expect(plan.skipped).toEqual([{ date: "2026-08-29", reason: "weekend" }]);
  });

  it("расстановка при том же входе занятый день по-прежнему пропускает", () => {
    const plan = planEntryRange({
      from: MON, to: WED, category: "duty", includeWeekends: false, mode: "fill",
      occupied: { "2026-08-25": "work" },
      calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([MON, WED]);
    expect(plan.rewritten).toEqual([]);
    expect(plan.skipped).toEqual([{ date: "2026-08-25", reason: "busy" }]);
  });
});

/**
 * Одна фраза на обе консоли.
 *
 * Число занятых дней ни одна из форм не знает — расписания за пределами
 * показанной недели у них нет. Значит единственное, что стоит между админом и
 * необратимой правкой, — эта строка, и разъехаться в двух местах ей нельзя.
 */
describe("entryRangeHint", () => {
  it("у расстановки обещает пропуск занятых дней", () => {
    expect(entryRangeHint("fill")).toBe("Дни, где у человека уже что-то стоит, пропустятся.");
  });

  it("у перезаписи называет и что заменится, и что уцелеет", () => {
    expect(entryRangeHint("rewrite")).toBe(
      "Смены и дежурства в этих днях перепишутся; отпуск, больничный и командировка останутся на месте.",
    );
  });
});

describe("categoryFitsDate с календарём", () => {
  // 2026-06-12 — пятница, День России; 2024-04-27 — рабочая суббота по переносу.
  const cal = calendarFrom([{ date: "2026-06-12", kind: "holiday" }, { date: "2024-04-27", kind: "workday" }]);
  it("работа в выходной встаёт на праздник", () => {
    expect(categoryFitsDate("weekend_work", "2026-06-12", cal)).toBe(true);
    expect(categoryFitsDate("weekend_work", "2026-06-12", EMPTY_CALENDAR)).toBe(false);
  });
  it("и не встаёт на рабочую субботу", () => {
    expect(categoryFitsDate("weekend_work", "2024-04-27", cal)).toBe(false);
  });
});

describe("planEntryRange с календарём", () => {
  it("праздник пропускается как выходной, рабочая суббота — берётся", () => {
    // чт 11.06 … вс 14.06: пятница объявлена праздником, суббота — рабочей.
    const cal = calendarFrom([{ date: "2026-06-12", kind: "holiday" }, { date: "2026-06-13", kind: "workday" }]);
    const plan = planEntryRange({
      from: "2026-06-11", to: "2026-06-14", category: "shift", includeWeekends: false, mode: "fill", occupied: {}, calendar: cal,
    });
    expect(plan.days).toEqual(["2026-06-11", "2026-06-13"]);
    expect(plan.skipped).toEqual([{ date: "2026-06-12", reason: "weekend" }, { date: "2026-06-14", reason: "weekend" }]);
  });
});
