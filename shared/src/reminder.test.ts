import { describe, it, expect } from "vitest";
import {
  reminderKind,
  isReminderWorthy,
  wakeTime,
  buildReminderText,
  validateReminderTemplate,
  renderReminderText,
  validateReminderHour,
  REMINDER_TEXT_MAX,
  REMINDER_HOUR_LATEST,
  previewReminderText,
  remindsByDefault,
  dutyRun,
} from "./reminder";

describe("reminderKind", () => {
  it("morning: starts between 08:00 and 09:00 (not night)", () => {
    expect(reminderKind({ start: "08:00", end: "17:00" })).toBe("morning");
    expect(reminderKind({ start: "08:30", end: "17:30" })).toBe("morning");
  });

  it("early: раньше восьми — это уже не «утренняя», а ранняя", () => {
    // Его решение от 2026-08-26: подъём к семи стоит другого письма, чем к восьми.
    expect(reminderKind({ start: "07:00", end: "16:00" })).toBe("early");
    expect(reminderKind({ start: "06:30", end: "15:30" })).toBe("early");
    // Граница ровно на восьми: 08:00 — уже обычная утренняя.
    expect(reminderKind({ start: "07:59", end: "17:00" })).toBe("early");
  });

  it("the standard 09:00–18:00 is a day shift, not a morning one", () => {
    // The boundary is exclusive: «День» starts at exactly 09:00, and calling it
    // «утренняя» in a reminder was both noise and the wrong word.
    expect(reminderKind({ start: "09:00", end: "18:00" })).toBe("day");
    expect(reminderKind({ start: "08:59", end: "18:00" })).toBe("morning");
  });
  it("night: ends >= 22:00 (isNightShift)", () => {
    expect(reminderKind({ start: "15:00", end: "23:00" })).toBe("night");
  });
  it("night: overnight shift", () => {
    expect(reminderKind({ start: "23:00", end: "07:00" })).toBe("night");
  });
  it("evening: ends at/after 20:00, not night, not morning", () => {
    expect(reminderKind({ start: "11:00", end: "20:00" })).toBe("evening");
  });
  it("day: otherwise", () => {
    expect(reminderKind({ start: "10:00", end: "18:00" })).toBe("day");
  });
});

describe("isReminderWorthy", () => {
  it("reminds about the shifts that change your evening", () => {
    expect(isReminderWorthy({ start: "07:00", end: "16:00" }), "ранняя").toBe(true);
    expect(isReminderWorthy({ start: "08:00", end: "17:00" }), "утро").toBe(true);
    expect(isReminderWorthy({ start: "11:00", end: "20:00" }), "вечер").toBe(true);
    expect(isReminderWorthy({ start: "15:00", end: "23:00" }), "ночь").toBe(true);
    expect(isReminderWorthy({ start: "23:00", end: "07:00" }), "ночь через полночь").toBe(true);
  });

  it("stays silent about the plain day shift", () => {
    // 09:00–18:00 is what everybody expects by default. A nightly message about
    // it is the fastest way to teach people to ignore the ones that matter.
    expect(isReminderWorthy({ start: "10:00", end: "18:00" })).toBe(false);
    expect(isReminderWorthy({ start: "09:30", end: "18:30" })).toBe(false);
  });
});

describe("wakeTime", () => {
  it("subtracts the prep buffer from the start time", () => {
    expect(wakeTime("08:00", 60)).toBe("07:00");
  });
  it("clamps at 00:00 (never goes negative)", () => {
    expect(wakeTime("00:30", 60)).toBe("00:00");
  });
});

describe("buildReminderText", () => {
  it("утренняя названа сменой, а не просто «утренняя»", () => {
    const text = buildReminderText({ name: "Аня", kind: "morning", timeRange: "08:00–17:00" });
    expect(text).toContain("утренняя смена");
  });

  it("во времени подъёма письмо не распоряжается", () => {
    // «Поставь будильник на 07:00» — сугубо личное дело, и в стандартном тексте
    // его нет ни у одного вида смены. Подстановка `{подъём}` осталась: захочет —
    // напишет сам. Его решение от 2026-08-26.
    for (const kind of ["early", "morning", "day", "evening", "night"] as const) {
      const text = buildReminderText({ name: "Аня", kind, timeRange: "08:00–17:00" });
      expect(text, kind).not.toContain("будильник");
    }
  });

  it("ранняя смена отличается от утренней словами, а не только временем", () => {
    const early = buildReminderText({ name: "Аня", kind: "early", timeRange: "07:00–16:00" });
    const morning = buildReminderText({ name: "Аня", kind: "morning", timeRange: "08:00–17:00" });
    expect(early).toContain("ранняя смена");
    expect(early).not.toBe(morning);
  });

  it("night message mentions resting during the day", () => {
    const text = buildReminderText({ name: "Игорь", kind: "night", timeRange: "23:00–07:00" });
    expect(text).toContain("Отдохни днём");
  });

  it("каждый вид смены здоровается по имени и называет часы", () => {
    for (const kind of ["early", "morning", "day", "evening", "night"] as const) {
      const text = buildReminderText({ name: "Аня", kind, timeRange: "08:00–17:00" });
      expect(text, kind).toContain("Аня");
      expect(text, kind).toContain("08:00–17:00");
    }
  });
});

describe("validateReminderTemplate", () => {
  it("принимает текст с известными подстановками", () => {
    expect(() => validateReminderTemplate("Привет, {имя}! Завтра {время}, встань в {подъём}.")).not.toThrow();
  });

  it("принимает текст вовсе без подстановок", () => {
    expect(() => validateReminderTemplate("Завтра смена. Не проспи.")).not.toThrow();
  });

  it("называет неизвестную подстановку, а не молчит о ней", () => {
    // Молчаливая подстановка пустоты — худший исход: админ увидит ошибку только
    // тогда, когда письмо уже ушло команде.
    expect(() => validateReminderTemplate("Завтра {погода} и {имя}")).toThrow(/погода/);
  });

  it("отказывает пустому тексту", () => {
    // Пустое поле означает «вернуть текст по умолчанию» и до валидатора не доходит;
    // строка из пробелов — это уже попытка сохранить пустое письмо.
    expect(() => validateReminderTemplate("   ")).toThrow();
  });

  it("отказывает тексту длиннее предела, называя длину", () => {
    expect(() => validateReminderTemplate("а".repeat(REMINDER_TEXT_MAX + 1))).toThrow(
      new RegExp(String(REMINDER_TEXT_MAX + 1)),
    );
    expect(() => validateReminderTemplate("а".repeat(REMINDER_TEXT_MAX))).not.toThrow();
  });
});

describe("renderReminderText", () => {
  const vars = { name: "Аня", timeRange: "08:00–17:00", wake: "07:00" };

  it("подставляет имя, время и подъём", () => {
    expect(renderReminderText("{имя}, завтра {время}, подъём в {подъём}", vars)).toBe(
      "Аня, завтра 08:00–17:00, подъём в 07:00",
    );
  });

  it("терпит «подъем» без ё и любой регистр", () => {
    // Клавиатура без ё — не повод получить в письме «{подъем}» вместо времени.
    expect(renderReminderText("{Имя} встаёт в {подъем}", vars)).toBe("Аня встаёт в 07:00");
  });

  it("заменяет подстановку столько раз, сколько она встретилась", () => {
    expect(renderReminderText("{имя}, {имя}!", vars)).toBe("Аня, Аня!");
  });

  it("оставляет текст без подстановок нетронутым", () => {
    expect(renderReminderText("Завтра смена, не проспи", vars)).toBe("Завтра смена, не проспи");
  });
});

describe("validateReminderHour", () => {
  it("принимает час в пределах суток", () => {
    expect(() => validateReminderHour("20:00")).not.toThrow();
    expect(() => validateReminderHour("00:00")).not.toThrow();
    expect(() => validateReminderHour("07:35")).not.toThrow();
  });

  it("отказывает часу позже последнего безопасного", () => {
    // Тик пятиминутный и не выровнен по часам: за 23:45 можно проскочить полночь,
    // а после неё «завтра» — это уже послезавтра, и письмо не уйдёт вовсе.
    expect(() => validateReminderHour("23:45")).toThrow();
    expect(() => validateReminderHour(REMINDER_HOUR_LATEST)).not.toThrow();
  });

  it("отказывает всему, что не HH:MM", () => {
    expect(() => validateReminderHour("8:00")).toThrow();
    expect(() => validateReminderHour("24:00")).toThrow();
    expect(() => validateReminderHour("20:60")).toThrow();
    expect(() => validateReminderHour("вечером")).toThrow();
  });
});

describe("previewReminderText", () => {
  it("показывает письмо на примере, а не сырые подстановки", () => {
    const preview = previewReminderText("{имя}, завтра {время}");
    expect(preview.ok).toBe(true);
    expect(preview.ok && preview.text).toBe("Аня, завтра 08:00–17:00");
  });

  it("вместо предпросмотра отдаёт причину, по которой текст не сохранится", () => {
    // Тот же текст ошибки, что вернёт сервер: админ не должен узнавать о запрете
    // только по отказу на кнопке.
    const preview = previewReminderText("Завтра {погода}");
    expect(preview.ok).toBe(false);
    expect(!preview.ok && preview.error).toMatch(/погода/);
  });
});

describe("remindsByDefault", () => {
  it("про дежурство напоминает, даже если часы у него обычные дневные", () => {
    // Дежурства идут 09:00–18:00, ровно как «День», и по одним часам их не
    // отличить. Отличает категория: дежурство — не рутина.
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "duty" })).toBe(true);
  });

  it("про обычную дневную смену молчит — она и есть то, чего все ждут", () => {
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "shift" })).toBe(false);
  });

  it("про смену с необычными часами напоминает и внутри обычных смен", () => {
    expect(remindsByDefault({ start: "08:00", end: "17:00", category: "shift" })).toBe(true);
    expect(remindsByDefault({ start: "11:00", end: "20:00", category: "shift" })).toBe(true);
  });

  it("про отсутствие не напоминает: «завтра у тебя смена» отпуску не адресовано", () => {
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "vacation" })).toBe(false);
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "sick_leave" })).toBe(false);
  });

  it("выезд и работа в выходной — тоже не рутина", () => {
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "offsite" })).toBe(true);
    expect(remindsByDefault({ start: "09:00", end: "18:00", category: "weekend_work" })).toBe(true);
  });
});

describe("buildReminderText: чем это будет завтра", () => {
  it("называет вид смены, если он не обычная смена", () => {
    // Иначе письмо про дежурство слово в слово совпадает с письмом про смену,
    // и человек не поймёт, что завтра он дежурный.
    const text = buildReminderText({
      name: "Аня",
      kind: "day",
      timeRange: "09:00–18:00",
      what: "Дежурство · Поклонка",
    });
    expect(text).toContain("Дежурство · Поклонка");
  });

  it("без названия говорит просто «смена»", () => {
    const text = buildReminderText({ name: "Аня", kind: "day", timeRange: "09:00–18:00" });
    expect(text).toContain("завтра смена");
    expect(text).not.toContain("«");
  });
});

describe("dutyRun — один день дежурства или отрезок", () => {
  const held = (...dates: string[]) => new Set(dates);

  it("одиночный день: отрезок кончается им же и ничего не продолжает", () => {
    const run = dutyRun(held("2026-06-03"), "2026-06-03");
    expect(run).toEqual({ continuing: false, lastDate: "2026-06-03" });
  });

  it("недельное дежурство: с понедельника по пятницу — один отрезок", () => {
    // Пн 2026-06-01 … Пт 2026-06-05. Выходных в наборе нет, и отрезок кончается
    // пятницей сам собой — недельность вычитается из графика, а не из настройки
    // очереди, которую могли не выставить.
    const week = held("2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05");
    expect(dutyRun(week, "2026-06-01")).toEqual({ continuing: false, lastDate: "2026-06-05" });
  });

  it("середина недели — продолжение: человеку уже написали в воскресенье", () => {
    const week = held("2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05");
    expect(dutyRun(week, "2026-06-03").continuing).toBe(true);
  });

  it("два одиночных дня через промежуток — два разных отрезка", () => {
    // «Поклонка во вторник и в пятницу» — про каждый день предупреждают отдельно.
    const spread = held("2026-06-02", "2026-06-05");
    expect(dutyRun(spread, "2026-06-02")).toEqual({ continuing: false, lastDate: "2026-06-02" });
    expect(dutyRun(spread, "2026-06-05")).toEqual({ continuing: false, lastDate: "2026-06-05" });
  });
});

describe("buildReminderText: отрезок дежурства", () => {
  it("называет последний день, когда дежурство не на один день", () => {
    // «Завтра дежурство» про пятидневный отрезок — неправда, по которой человек
    // спланирует только понедельник.
    const text = buildReminderText({
      name: "Аня",
      kind: "day",
      timeRange: "09:00–18:00",
      what: "Дежурство · Поклонка",
      until: "2026-06-05",
    });
    expect(text).toContain("5 июня");
    expect(text).toContain("Дежурство · Поклонка");
  });

  it("про одиночный день говорит «завтра», без диапазона", () => {
    const text = buildReminderText({ name: "Аня", kind: "day", timeRange: "09:00–18:00", what: "Дежурство · Телефон" });
    expect(text).toContain("Завтра");
    expect(text).toContain("«Дежурство · Телефон»");
    // Диапазона нет: день одиночный, и «по 5 июня» было бы шумом.
    expect(text).not.toContain("по ");
  });
});
