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
} from "./reminder";

describe("reminderKind", () => {
  it("morning: starts before 09:00 (not night)", () => {
    expect(reminderKind({ start: "08:00", end: "17:00" })).toBe("morning");
    expect(reminderKind({ start: "07:00", end: "16:00" })).toBe("morning");
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
  it("reminds about the three shifts that change your evening", () => {
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
  it("morning message contains the wake time and mentions the alarm", () => {
    const text = buildReminderText({ name: "Аня", kind: "morning", timeRange: "08:00–17:00", wake: "07:00" });
    expect(text).toContain("07:00");
    expect(text).toContain("будильник");
  });
  it("night message mentions resting during the day", () => {
    const text = buildReminderText({ name: "Игорь", kind: "night", timeRange: "23:00–07:00" });
    expect(text).toContain("Отдохни днём");
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
