import { describe, it, expect } from "vitest";
import { entryCategorySchema, isSwappable } from "@planer/shared";
import type { Shift } from "../api/client";
import { swapCandidates } from "./swap-candidates";

/**
 * У мини-аппа не должно быть СВОЕГО мнения о том, чем можно меняться.
 *
 * Правило жило здесь рукописной копией (`shift.category !== "shift"`), и пока
 * ответ был «только смены», три копии — shared, этот список и кнопка
 * «Обменять» — совпадали случайно. Стоило открыть дежурства, и расхождение
 * стало бы наблюдаемым дефектом: экран прячет кандидата, которого сервер
 * принимает.
 *
 * Тест сверяет не строки, а поведение, и перебирает ВСЕ категории — поэтому
 * следующая открытая категория не потребует правки этого файла.
 */
const NOW = new Date("2026-07-10T06:00:00Z");

const mine: Shift = {
  id: 1, date: "2026-07-10", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "День", location: null, templateId: null,
  employeeId: 1, unrecognisedCode: null,
};

describe("свапаемость в мини-аппе = свапаемость в shared", () => {
  it.each(entryCategorySchema.options)("%s", (category) => {
    const theirs: Shift = {
      ...mine, id: 2, employeeId: 2, category,
      // Другие часы и без подписи — чтобы единственной переменной осталась
      // категория, а не «та же самая смена».
      start: "11:00", end: "20:00", title: null,
    };
    const { candidates } = swapCandidates(mine, [theirs], 1, NOW, new Set());
    expect(candidates.length === 1).toBe(isSwappable(category));
  });
});
