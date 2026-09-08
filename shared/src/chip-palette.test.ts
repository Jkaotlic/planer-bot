import { describe, expect, it } from "vitest";
import {
  CATEGORY_PALETTES_DARK,
  CATEGORY_PALETTES_LIGHT,
  VACATION_SCHEDULE_PALETTE,
  categoryChipPalette,
} from "./schedule-palette";
import { entryCategorySchema } from "./category";

/**
 * Цвет чипа и цвет клетки — разные задачи, и раньше это была одна таблица.
 *
 * Клетка сетки стоит в решётке с рамкой и подписана буквой: там читается и
 * почти белый «#EAF0F0» у дня, и кричащий «#FD0100» у отпуска. Чип стоит сам
 * по себе на карточке: у него нет ни рамки, ни соседей, и те же цвета либо
 * исчезают на белом, либо орут. Пары `CATEGORY_PALETTES_*` для этого и писались
 * — но `categoryPalette` возвращала цвет клетки раньше, чем до них доходило, и
 * пять категорий из семи их не видели никогда.
 */

const ALL = entryCategorySchema.options;

/** Относительная яркость по WCAG — та же формула, что у браузера. */
function luminance(hex: string): number {
  const n = hex.replace("#", "");
  const parts = [n.slice(0, 2), n.slice(2, 4), n.slice(4, 6)].map((h) => {
    const v = Number.parseInt(h, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("палитра чипа", () => {
  it("для каждой категории берёт пару, настроенную под тему, а не цвет клетки", () => {
    for (const category of ALL) {
      expect(categoryChipPalette(category, false), category).toEqual(CATEGORY_PALETTES_LIGHT[category]);
      expect(categoryChipPalette(category, true), category).toEqual(CATEGORY_PALETTES_DARK[category]);
    }
  });

  it("не отдаёт цвета клеток — иначе отпуск снова станет чистым красным", () => {
    expect(categoryChipPalette("vacation", false).bg).not.toBe(VACATION_SCHEDULE_PALETTE.bg);
    expect(categoryChipPalette("vacation", true).bg).not.toBe(VACATION_SCHEDULE_PALETTE.bg);
  });

  it("держит текст читаемым: контраст подписи к подложке не ниже 4.5 в светлой теме", () => {
    for (const category of ALL) {
      const { bg, fg } = categoryChipPalette(category, false);
      expect(contrast(bg, fg), `${category} ${bg}/${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
