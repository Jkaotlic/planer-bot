import { describe, expect, it } from "vitest";
import {
  absenceReplaceHint,
  categoryFitsDate,
  cutDaysFromSpan,
  describeEntryRangePlan,
  describeEntryRangeResult,
  entryRangeHint,
  entryRangeOccupancy,
  planEntryRange,
  absenceDaysOf,
  rewritesOutsideAbsence,
} from "./entry-range";
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

/**
 * Явная замена отсутствия рабочей записью (прод, 2026-10-16).
 *
 * Админ открыл свой отпуск 12–17 и сохранил его сменой «День» — перезапись
 * пропустила все шесть дней как «отсутствие», и не поменялось ничего. Правило
 * владельца: админ меняет любому что и когда захочет. Но молча — нет: замена
 * идёт только по явному флагу, а без него всё как раньше.
 */
describe("planEntryRange с заменой отсутствия", () => {
  // 2026-10-12 — понедельник, 17-е — суббота.
  const vacation = {
    "2026-10-12": "absence", "2026-10-13": "absence", "2026-10-14": "absence",
    "2026-10-15": "absence", "2026-10-16": "absence", "2026-10-17": "absence",
  } as const;

  it("день отпуска получает запись и попадает в список заменённых", () => {
    const plan = planEntryRange({
      from: "2026-10-16", to: "2026-10-16", category: "shift", includeWeekends: false, mode: "rewrite",
      replaceAbsences: true, occupied: vacation, calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual(["2026-10-16"]);
    expect(plan.replacedAbsence).toEqual(["2026-10-16"]);
    expect(plan.rewritten).toEqual([]);
    expect(plan.skipped).toEqual([]);
  });

  it("без флага отпуск по-прежнему пропускается", () => {
    const plan = planEntryRange({
      from: "2026-10-16", to: "2026-10-16", category: "shift", includeWeekends: false, mode: "rewrite",
      occupied: vacation, calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual([]);
    expect(plan.replacedAbsence).toEqual([]);
    expect(plan.skipped).toEqual([{ date: "2026-10-16", reason: "absence" }]);
  });

  // Отпуск режется только там, где реально встаёт смена: суббота без галочки
  // «Включая выходные» смены не получит — и отпуска не потеряет.
  it("выходной без галочки не заменяет", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-17", category: "shift", includeWeekends: false, mode: "rewrite",
      replaceAbsences: true, occupied: vacation, calendar: EMPTY_CALENDAR,
    });
    expect(plan.replacedAbsence).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    expect(plan.skipped).toEqual([{ date: "2026-10-17", reason: "weekend" }]);
  });

  it("расстановка с флагом тоже заменяет отпуск, а занятый работой день пропускает", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-13", category: "shift", includeWeekends: false, mode: "fill",
      replaceAbsences: true, occupied: { "2026-10-12": "absence", "2026-10-13": "work" }, calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual(["2026-10-12"]);
    expect(plan.replacedAbsence).toEqual(["2026-10-12"]);
    expect(plan.skipped).toEqual([{ date: "2026-10-13", reason: "busy" }]);
  });

  // Больничный, под которым стоит своя смена человека (её он и отдаёт коллегам):
  // заменить больничный значит переписать эту смену и вырезать больничный из дня.
  it("день «отсутствие и смена» перезапись с флагом переписывает и вырезает", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-12", category: "duty", includeWeekends: false, mode: "rewrite",
      replaceAbsences: true, occupied: { "2026-10-12": "absence_and_work" }, calendar: EMPTY_CALENDAR,
    });
    expect(plan.days).toEqual(["2026-10-12"]);
    expect(plan.rewritten).toEqual(["2026-10-12"]);
    expect(plan.replacedAbsence).toEqual(["2026-10-12"]);
  });

  it("день «отсутствие и смена» без флага пропускается с причиной «отсутствие»", () => {
    const rewrite = planEntryRange({
      from: "2026-10-12", to: "2026-10-12", category: "duty", includeWeekends: false, mode: "rewrite",
      occupied: { "2026-10-12": "absence_and_work" }, calendar: EMPTY_CALENDAR,
    });
    expect(rewrite.skipped).toEqual([{ date: "2026-10-12", reason: "absence" }]);
    const fill = planEntryRange({
      from: "2026-10-12", to: "2026-10-12", category: "duty", includeWeekends: false, mode: "fill",
      replaceAbsences: true, occupied: { "2026-10-12": "absence_and_work" }, calendar: EMPTY_CALENDAR,
    });
    expect(fill.skipped).toEqual([{ date: "2026-10-12", reason: "busy" }]);
    expect(fill.replacedAbsence).toEqual([]);
  });

  it("день с двумя записями не заменяет и с флагом", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-12", category: "duty", includeWeekends: false, mode: "rewrite",
      replaceAbsences: true, occupied: { "2026-10-12": "ambiguous" }, calendar: EMPTY_CALENDAR,
    });
    expect(plan.skipped).toEqual([{ date: "2026-10-12", reason: "ambiguous" }]);
  });

  it("план отсутствия флагом не меняется — заменять отпуск отпуском нечего", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-14", category: "vacation", includeWeekends: false, mode: "rewrite",
      replaceAbsences: true, occupied: vacation, calendar: EMPTY_CALENDAR,
    });
    expect(plan).toEqual({ days: ["2026-10-12"], rewritten: [], replacedAbsence: [], skipped: [] });
  });
});

/**
 * Замена ОДНОГО отсутствия — путь правки (проверка ветки, 2026-10-16). Админ
 * правит отпуск 12–17 в «День» и тянет «По» до 24-го: общий флаг срезал бы и
 * отпуск 20–25, о котором форма молчит. Решение владельца: из правки заменяется
 * только правимая запись, остальные отсутствия пропускаются как без флага.
 */
describe("planEntryRange с заменой только названных дней", () => {
  const twoVacations = {
    "2026-10-12": "absence", "2026-10-13": "absence", "2026-10-14": "absence",
    "2026-10-15": "absence", "2026-10-16": "absence", "2026-10-17": "absence",
    "2026-10-20": "absence", "2026-10-21": "absence", "2026-10-22": "absence",
    "2026-10-23": "absence", "2026-10-24": "absence", "2026-10-25": "absence",
  } as const;

  it("заменяет отсутствие только в названных днях, остальное — пропуск по отсутствию", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-24", category: "shift", includeWeekends: false, mode: "rewrite",
      replaceAbsenceDays: new Set(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]),
      occupied: twoVacations, calendar: EMPTY_CALENDAR,
    });
    expect(plan.replacedAbsence).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]);
    // 19-е свободно — смена встаёт; 20–23 — второй отпуск, его не трогают.
    expect(plan.days).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"]);
    expect(plan.skipped.filter((s) => s.reason === "absence").map((s) => s.date))
      .toEqual(["2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
  });

  it("день «отсутствие и смена» вне названных — пропуск по отсутствию", () => {
    const plan = planEntryRange({
      from: "2026-10-12", to: "2026-10-12", category: "duty", includeWeekends: false, mode: "rewrite",
      replaceAbsenceDays: new Set(["2026-10-13"]),
      occupied: { "2026-10-12": "absence_and_work" }, calendar: EMPTY_CALENDAR,
    });
    expect(plan.skipped).toEqual([{ date: "2026-10-12", reason: "absence" }]);
  });

  it("дни отсутствия по id — только те, где именно эта запись единственная", () => {
    const first = { id: 1, date: "2026-10-12", endDate: "2026-10-14", category: "vacation" as const };
    const second = { id: 2, date: "2026-10-14", endDate: "2026-10-15", category: "sick_leave" as const };
    const occupancy = entryRangeOccupancy([first, second]);
    // 14-е — два отсутствия, день двусмысленный, и «чей» он, сказать нельзя.
    expect(absenceDaysOf(occupancy, 1)).toEqual(new Set(["2026-10-12", "2026-10-13"]));
    expect(absenceDaysOf(occupancy, 2)).toEqual(new Set(["2026-10-15"]));
    expect(absenceDaysOf(occupancy, 99)).toEqual(new Set());
  });
});

describe("entryRangeOccupancy", () => {
  it("называет день по тому, что в нём стоит, и помнит, какая запись", () => {
    const vacation = { id: 1, date: "2026-10-12", endDate: "2026-10-14", category: "vacation" as const };
    const shift = { id: 2, date: "2026-10-13", endDate: null, category: "shift" as const };
    const duty = { id: 3, date: "2026-10-15", endDate: null, category: "duty" as const };
    const duty2 = { id: 4, date: "2026-10-15", endDate: null, category: "shift" as const };
    const { occupied, work, absence } = entryRangeOccupancy([vacation, shift, duty, duty2]);
    expect(occupied).toEqual({
      "2026-10-12": "absence",
      "2026-10-13": "absence_and_work",
      "2026-10-14": "absence",
      "2026-10-15": "ambiguous",
    });
    expect(work.get("2026-10-13")).toBe(shift);
    expect(absence.get("2026-10-13")).toBe(vacation);
    expect(work.has("2026-10-15")).toBe(false);
  });

  it("два отсутствия в одном дне — двусмысленный день", () => {
    const { occupied, absence } = entryRangeOccupancy([
      { date: "2026-10-12", endDate: null, category: "vacation" as const },
      { date: "2026-10-12", endDate: null, category: "sick_leave" as const },
    ]);
    expect(occupied["2026-10-12"]).toBe("ambiguous");
    expect(absence.has("2026-10-12")).toBe(false);
  });
});

describe("cutDaysFromSpan", () => {
  it("день в середине делит полосу на две", () => {
    expect(cutDaysFromSpan({ date: "2026-10-12", endDate: "2026-10-17" }, ["2026-10-16"])).toEqual([
      { date: "2026-10-12", endDate: "2026-10-15" },
      { date: "2026-10-17", endDate: null },
    ]);
  });

  it("с краю — укорачивает", () => {
    expect(cutDaysFromSpan({ date: "2026-10-12", endDate: "2026-10-17" }, ["2026-10-12", "2026-10-13"])).toEqual([
      { date: "2026-10-14", endDate: "2026-10-17" },
    ]);
  });

  it("целиком — ничего не оставляет", () => {
    expect(cutDaysFromSpan({ date: "2026-10-12", endDate: "2026-10-13" }, ["2026-10-12", "2026-10-13"])).toEqual([]);
  });

  it("дни вне полосы не трогает", () => {
    expect(cutDaysFromSpan({ date: "2026-10-12", endDate: null }, ["2026-10-20"])).toEqual([{ date: "2026-10-12", endDate: null }]);
  });

  it("выходной, оставшийся между заменёнными буднями, остаётся отдельным куском", () => {
    expect(
      cutDaysFromSpan({ date: "2026-10-16", endDate: "2026-10-19" }, ["2026-10-16", "2026-10-19"]),
    ).toEqual([{ date: "2026-10-17", endDate: "2026-10-18" }]);
  });
});

describe("счёт замены отсутствия", () => {
  // Замена необратима так же, как перезапись: число видно ДО нажатия.
  it("предпросмотр называет, сколько дней отсутствия заменится", () => {
    expect(describeEntryRangePlan({ days: ["a", "b"], rewritten: [], replacedAbsence: ["a", "b"], skipped: [] }))
      .toBe("2 дня · 2 дня отсутствия заменятся");
    expect(describeEntryRangePlan({ days: ["a"], rewritten: [], replacedAbsence: ["a"], skipped: [] }))
      .toBe("1 день · 1 день отсутствия заменится");
  });

  it("итог говорит в прошедшем времени", () => {
    expect(describeEntryRangeResult({
      created: [{ date: "2026-10-16" }], skipped: [], replacedAbsence: ["2026-10-16"],
    })).toBe("Поставлено 1 день · 1 день отсутствия заменён");
    expect(describeEntryRangeResult({
      created: [{ date: "2026-10-15" }, { date: "2026-10-16" }], skipped: [], replacedAbsence: ["2026-10-15", "2026-10-16"],
    })).toBe("Поставлено 2 дня · 2 дня отсутствия заменено");
  });
});

describe("подсказки с заменой отсутствия", () => {
  // Подсказка обязана быть правдой в обоих случаях: с флагом «останутся на
  // месте» про отпуск соврало бы ровно перед необратимым нажатием.
  it("перезапись с флагом не обещает, что отпуск останется", () => {
    const text = entryRangeHint("rewrite", true);
    expect(text).not.toContain("останутся на месте");
    expect(text).toBe("Смены и дежурства в этих днях перепишутся, а любые отпуск, больничный и командировка в выбранных днях уступят место новой записи там, где она встанет.");
  });

  it("расстановка с флагом говорит, что занятые работой дни пропустятся", () => {
    expect(entryRangeHint("fill", true)).toBe(
      "Дни со сменой или дежурством пропустятся, а любые отпуск, больничный и командировка в выбранных днях уступят место новой записи там, где она встанет.",
    );
  });

  it("без флага — прежние фразы", () => {
    expect(entryRangeHint("fill", false)).toBe(entryRangeHint("fill"));
    expect(entryRangeHint("rewrite", false)).toBe(entryRangeHint("rewrite"));
  });

  it("правка отсутствия называет его по имени", () => {
    expect(absenceReplaceHint("vacation", 2, false)).toBe(
      "Отпуск в эти дни заменится новой записью и останется только там, куда она не встанет. Другие отсутствия в этих днях останутся на месте.",
    );
    expect(absenceReplaceHint("business_trip", 1, false)).toBe(
      "Командировка в эти дни заменится новой записью и останется только там, куда она не встанет. Другие отсутствия в этих днях останутся на месте.",
    );
  });

  it("выбранные дни не задевают правимое отсутствие — подсказка не обещает замены", () => {
    expect(absenceReplaceHint("vacation", 0, false)).toBe("Отпуск выбранных дней не касается и останется как есть.");
  });

  // «С/По» шире отпуска уходят в режим `rewrite`: смены и дежурства в днях за
  // пределами отпуска перепишутся, а подсказка говорила только про отпуск —
  // обычная правка об этом предупреждает, правка отсутствия молчала.
  it("«С/По» шире отсутствия — подсказка говорит, что остальные дни перепишутся", () => {
    expect(absenceReplaceHint("vacation", 2, true)).toBe(
      "Отпуск в эти дни заменится новой записью и останется только там, куда она не встанет. Другие отсутствия в этих днях останутся на месте. Смены и дежурства в остальных днях перепишутся.",
    );
  });

  it("«С/По» мимо отсутствия — замены не обещает, но про перезапись говорит", () => {
    // «В остальных» здесь врало бы: остальных нет, перепишутся все выбранные.
    expect(absenceReplaceHint("vacation", 0, true)).toBe(
      "Отпуск выбранных дней не касается и останется как есть. Смены и дежурства в выбранных днях перепишутся.",
    );
  });
});

/**
 * Обе консоли решают «есть ли в „С/По“ дни вне правимого отсутствия» одним
 * правилом — иначе одна предупредит о перезаписи, а другая промолчит.
 */
describe("rewritesOutsideAbsence", () => {
  const vacation = { date: "2026-08-25", endDate: "2026-08-27" };

  it("все дни внутри отсутствия — нет", () => {
    expect(rewritesOutsideAbsence(["2026-08-25", "2026-08-26", "2026-08-27"], vacation)).toBe(false);
  });

  it("день до начала — да", () => {
    expect(rewritesOutsideAbsence(["2026-08-24", "2026-08-25"], vacation)).toBe(true);
  });

  it("день после конца — да", () => {
    expect(rewritesOutsideAbsence(["2026-08-27", "2026-08-28"], vacation)).toBe(true);
  });

  it("однодневное отсутствие без конца — соседний день снаружи", () => {
    expect(rewritesOutsideAbsence(["2026-08-25"], { date: "2026-08-25", endDate: null })).toBe(false);
    expect(rewritesOutsideAbsence(["2026-08-25", "2026-08-26"], { date: "2026-08-25", endDate: null })).toBe(true);
  });
});
