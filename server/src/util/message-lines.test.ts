import { describe, expect, it } from "vitest";
import { entryLineOf, shiftLineOf } from "./message-lines";
import { makeTestDb } from "../db/testdb";
import { createShift } from "../repo/shifts";
import { shiftTemplates } from "../db/schema";

/**
 * Строка про одну запись графика — то, чем письмо об изменении называет смену.
 * Слова те же, что человек увидит в клетке: подпись важнее категории, потому
 * что клетка подписана `title ?? categoryLabel(category)`.
 */
describe("entryLineOf", () => {
  const base = {
    date: "2026-08-07",
    endDate: null,
    start: "15:00",
    end: "23:00",
    category: "shift" as const,
    title: "Вечер",
  };

  it("смена: день, часы и как она называется", () => {
    expect(entryLineOf(base)).toBe("Пт 7 авг · 15:00–23:00 · Вечер");
  });

  it("без подписи называет категорию", () => {
    expect(entryLineOf({ ...base, title: null })).toBe("Пт 7 авг · 15:00–23:00 · Смена");
  });

  it("отсутствие без часов — «весь день»", () => {
    expect(entryLineOf({ ...base, start: null, end: null, category: "vacation", title: null })).toBe(
      "Пт 7 авг · весь день · Отпуск",
    );
  });

  it("многодневное отсутствие называет обе даты", () => {
    expect(
      entryLineOf({ date: "2026-08-06", endDate: "2026-08-07", start: null, end: null, category: "vacation", title: null }),
    ).toBe("Чт 6 авг – Пт 7 авг · весь день · Отпуск");
  });

  it("endDate, равный дате, второй датой не считается", () => {
    expect(entryLineOf({ ...base, endDate: "2026-08-07" })).toBe("Пт 7 авг · 15:00–23:00 · Вечер");
  });
});

/**
 * Та же подпись, что в клетке графика, — теперь и в сообщениях про обмен.
 *
 * Раньше здесь была своя, третья по счёту, копия форматирования даты, и она
 * называла только день и часы. Из-за этого сообщение с кнопками
 * «Принять/Отклонить» не говорило, что в обмене дежурство: человек брал
 * Поклонку, читая «Ср 12 авг · 09:00–18:00».
 */
describe("shiftLineOf", () => {
  const preset = (db: ReturnType<typeof makeTestDb>, name: string, start: string, end: string) =>
    db.insert(shiftTemplates).values({ name, category: "duty", start, end }).returning().all()[0]!;

  it("дежурство называет себя", () => {
    const db = makeTestDb();
    const tpl = preset(db, "Дежурство · Поклонка", "09:00", "18:00");
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: tpl.id, title: tpl.name,
    });
    expect(shiftLineOf(db, duty.id)).toBe("Пт 10 июл · 09:00–18:00 · Дежурство · Поклонка");
  });

  it("без своей подписи берёт имя пресета", () => {
    const db = makeTestDb();
    const tpl = preset(db, "Дежурство · Телефон", "09:00", "18:00");
    const duty = createShift(db, {
      date: "2026-07-10", start: "09:00", end: "18:00", category: "duty",
      templateId: tpl.id, title: null,
    });
    expect(shiftLineOf(db, duty.id)).toBe("Пт 10 июл · 09:00–18:00 · Дежурство · Телефон");
  });

  it("без пресета и без подписи называет категорию", () => {
    const db = makeTestDb();
    const shift = createShift(db, { date: "2026-07-13", start: "08:00", end: "17:00" });
    expect(shiftLineOf(db, shift.id)).toBe("Пн 13 июл · 08:00–17:00 · Смена");
  });

  it("обычная смена называется своей подписью", () => {
    const db = makeTestDb();
    const shift = createShift(db, { date: "2026-07-13", start: "08:00", end: "17:00", title: "Утро" });
    expect(shiftLineOf(db, shift.id)).toBe("Пн 13 июл · 08:00–17:00 · Утро");
  });

  it("пропавшая запись остаётся «смену» — заявка переживает свою смену", () => {
    const db = makeTestDb();
    expect(shiftLineOf(db, null)).toBe("смену");
    expect(shiftLineOf(db, 9999)).toBe("смену");
  });
});
