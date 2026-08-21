import { describe, expect, it } from "vitest";
import { AVATAR_PALETTE, initialsOf, personPalette } from "./person-identity";

/**
 * Как человек опознаётся в списке: две буквы и цвет.
 *
 * Правило переехало в shared из двух одинаковых `lib/people.ts` — консольного и
 * мини-аппного. Пара зеркальных файлов в этом репозитории уже расходилась
 * трижды (линза `mirrors` в ledger'е), а здесь расхождение видно сразу: один и
 * тот же человек читался бы разным цветом на двух экранах.
 */
describe("initialsOf", () => {
  it("берёт по букве от фамилии и имени", () => {
    expect(initialsOf("Смирнова Аня")).toBe("СА");
  });

  it("из одного слова берёт одну букву", () => {
    expect(initialsOf("Аня")).toBe("А");
  });

  it("не спотыкается о лишние пробелы и пустое имя", () => {
    expect(initialsOf("  Смирнова   Аня  ")).toBe("СА");
    expect(initialsOf("")).toBe("");
  });
});

describe("personPalette", () => {
  it("один и тот же человек всегда одного цвета", () => {
    expect(personPalette(7)).toEqual(personPalette(7));
  });

  /**
   * Ради этого палитра и расширялась. Было пять цветов на команду из двух с
   * лишним десятков человек: каждый цвет носили пятеро, и он не опознавал
   * никого — соседние строки списка сливались в «одного и того же».
   */
  it("даёт достаточно цветов, чтобы соседи по ростеру не совпадали", () => {
    expect(AVATAR_PALETTE.length).toBeGreaterThanOrEqual(12);
    const consecutive = Array.from({ length: AVATAR_PALETTE.length }, (_, i) => personPalette(i + 1).bg);
    expect(new Set(consecutive).size).toBe(AVATAR_PALETTE.length);
  });

  // Первые пять цветов остались на своих местах намеренно: у людей с id 1..5
  // цвет не должен смениться из-за того, что палитру расширили. Оранжевый —
  // единственное исключение: он не проходил порог контраста и затемнён.
  it("не перекрашивает тех, кто уже был раскрашен", () => {
    expect(personPalette(1).bg).toBe("#3390EC");
    expect(personPalette(2).bg).toBe("#CE780A");
    expect(personPalette(3).bg).toBe("#2AA84F");
    expect(personPalette(4).bg).toBe("#8A55E0");
    expect(personPalette(5).bg).toBe("#0F9AA8");
  });

  it("вакансию без человека красит первым цветом, а не падает", () => {
    expect(personPalette(null)).toEqual(personPalette(1));
  });

  it("отрицательный id не выводит за границы палитры", () => {
    expect(AVATAR_PALETTE).toContainEqual(personPalette(-3));
  });

  // Белый текст на этих фонах читается только если фон достаточно тёмный.
  // Проверяется формулой контраста, а не глазами: цвет добавят позже и глазами
  // проверять не станут.
  it("держит контраст белого текста на каждом фоне не ниже 3:1", () => {
    for (const swatch of AVATAR_PALETTE) {
      expect({ bg: swatch.bg, ratio: contrastWithWhite(swatch.bg) }).toEqual({
        bg: swatch.bg,
        ratio: expect.any(Number),
      });
      expect(contrastWithWhite(swatch.bg)).toBeGreaterThanOrEqual(3);
    }
  });
});

/** WCAG relative luminance contrast between `hex` and pure white. */
function contrastWithWhite(hex: string): number {
  const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const r = channel(Number.parseInt(hex.slice(1, 3), 16) / 255);
  const g = channel(Number.parseInt(hex.slice(3, 5), 16) / 255);
  const b = channel(Number.parseInt(hex.slice(5, 7), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return 1.05 / (luminance + 0.05);
}
