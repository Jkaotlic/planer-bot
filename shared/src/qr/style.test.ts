import { describe, expect, it } from "vitest";
import {
  DEFAULT_QR_STYLE,
  QR_CAPTION_MAX,
  QR_COLOR_KEYS,
  QR_COLORS,
  QR_SHAPES,
  QR_SHAPE_LABELS,
  parseSavedQrStyle,
  qrStyleSchema,
} from "./style";

/** Контраст по WCAG 2.x — тем же счётом, что `admin/src/css-tokens.test.ts`. */
function contrastWithWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return 1.05 / (lum + 0.05);
}

describe("палитра QR-кода", () => {
  it("шесть тёмных цветов в порядке спеки, у каждого русское имя", () => {
    expect(QR_COLOR_KEYS).toEqual(["black", "blue", "green", "purple", "burgundy", "graphite"]);
    expect(QR_COLOR_KEYS.map((k) => QR_COLORS[k].label)).toEqual(["Чёрный", "Синий", "Зелёный", "Фиолетовый", "Бордовый", "Графит"]);
  });

  // Камера читает код по разнице яркости: светлый цвет — код, который у части
  // команды не откроется. 7 — с запасом над 4.5 для текста.
  it.each(QR_COLOR_KEYS)("контраст «%s» к белому не ниже 7", (key) => {
    expect(contrastWithWhite(QR_COLORS[key].hex)).toBeGreaterThanOrEqual(7);
  });

  it("четыре формы с подписями из спеки", () => {
    expect(QR_SHAPES.map((s) => QR_SHAPE_LABELS[s])).toEqual(["Классика", "Точки", "Скруглённый", "Мягкий"]);
  });
});

describe("сохранённый стиль", () => {
  it("пусто — «Классика», чёрный, как бот рисовал всегда", () => {
    expect(parseSavedQrStyle(null)).toEqual({ shape: "classic", color: "black" });
    expect(parseSavedQrStyle(undefined)).toEqual(DEFAULT_QR_STYLE);
  });

  it("читает сохранённое", () => {
    expect(parseSavedQrStyle('{"shape":"dots","color":"blue"}')).toEqual({ shape: "dots", color: "blue" });
  });

  it("битый JSON, неизвестный цвет или лишнее поле — умолчание, а не исключение", () => {
    expect(parseSavedQrStyle("{oops")).toEqual(DEFAULT_QR_STYLE);
    expect(parseSavedQrStyle('{"shape":"dots","color":"pink"}')).toEqual(DEFAULT_QR_STYLE);
    expect(parseSavedQrStyle('{"shape":"dots","color":"blue","caption":"x"}')).toEqual(DEFAULT_QR_STYLE);
  });
});

describe("стиль одного кода", () => {
  it(`подпись до ${QR_CAPTION_MAX} знаков принимается, длиннее — нет`, () => {
    expect(qrStyleSchema.safeParse({ shape: "soft", color: "green", caption: "Ж".repeat(QR_CAPTION_MAX) }).success).toBe(true);
    expect(qrStyleSchema.safeParse({ shape: "soft", color: "green", caption: "Ж".repeat(QR_CAPTION_MAX + 1) }).success).toBe(false);
  });

  it("без подписи — тоже стиль", () => {
    expect(qrStyleSchema.safeParse({ shape: "classic", color: "black" }).success).toBe(true);
  });
});
