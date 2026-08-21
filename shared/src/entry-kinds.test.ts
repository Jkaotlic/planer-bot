import { describe, expect, it } from "vitest";
import { workPresets } from "./entry-kinds";

/**
 * Единый список видов записи (его пункт 5 от 2026-08-21: «смены и дежурства
 * должны быть все вместе, не надо их разделять»).
 */
const preset = (over: Partial<Parameters<typeof workPresets>[0][number]> = {}) => ({
  id: 1, name: "Утро", category: "shift" as const, sortOrder: 1,
  start: "08:00", end: "17:00", fridayStart: null, fridayEnd: null,
  location: null, accent: "gold", isLate: false, sendReminder: true,
  ...over,
});

describe("workPresets", () => {
  // Тест умер бы на прежнем поведении обеих форм: они брали
  // `templates.filter((t) => t.category === выбранная)`, то есть дежурство
  // нельзя было увидеть, не сказав сперва «Дежурство».
  it("смешивает смены и дежурства в одном порядке по sortOrder", () => {
    const list = workPresets([
      preset({ id: 3, name: "Дежурство · Поклонка", category: "duty", sortOrder: 3 }),
      preset({ id: 1, name: "Утро", category: "shift", sortOrder: 1 }),
      preset({ id: 4, name: "День", category: "shift", sortOrder: 4 }),
      preset({ id: 2, name: "Дежурство с 07:00", category: "duty", sortOrder: 2 }),
    ]);
    expect(list.map((t) => t.name)).toEqual([
      "Утро", "Дежурство с 07:00", "Дежурство · Поклонка", "День",
    ]);
  });

  // Отсутствие пресетом не бывает: у него нет часов, и в списке «что ставим»
  // оно живёт своей группой, а не среди смен.
  it("не пускает в список пресеты отсутствий, если такие завелись", () => {
    const list = workPresets([
      preset({ id: 1, category: "shift", sortOrder: 1 }),
      preset({ id: 2, name: "Отпуск", category: "vacation", sortOrder: 2 }),
    ]);
    expect(list.map((t) => t.id)).toEqual([1]);
  });

  it("мероприятие и работу в выходной считает работой, а не отсутствием", () => {
    const list = workPresets([
      preset({ id: 1, name: "Ярмарка", category: "offsite", sortOrder: 2 }),
      preset({ id: 2, name: "Суббота", category: "weekend_work", sortOrder: 1 }),
    ]);
    expect(list.map((t) => t.name)).toEqual(["Суббота", "Ярмарка"]);
  });

  it("равный sortOrder разводит по имени, а не по случайности порядка в массиве", () => {
    const list = workPresets([
      preset({ id: 1, name: "Ночь", sortOrder: 5 }),
      preset({ id: 2, name: "Вечер", sortOrder: 5 }),
    ]);
    expect(list.map((t) => t.name)).toEqual(["Вечер", "Ночь"]);
  });

  it("не трогает исходный массив", () => {
    const input = [preset({ id: 2, sortOrder: 2 }), preset({ id: 1, sortOrder: 1 })];
    workPresets(input);
    expect(input.map((t) => t.id)).toEqual([2, 1]);
  });
});
