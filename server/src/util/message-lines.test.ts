import { describe, expect, it } from "vitest";
import { entryLineOf } from "./message-lines";

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
