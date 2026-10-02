/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Vitest подменяет импорт .css пустой строкой, поэтому читаем файл напрямую.
const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

// Таблица стилей читается как текст: проверяем не вид, а то, что числа в ней не
// расползлись обратно. До токенов в файле жили 15 кеглей и 11 радиусов.

describe("токены оформления консоли", () => {
  it("токены объявлены со значениями из спеки", () => {
    for (const decl of [
      "--text-title: 20px", "--text-head: 15px", "--text-body: 14px", "--text-sub: 13px", "--text-meta: 12px",
      "--radius-card: 12px", "--radius-control: 8px", "--radius-pill: 999px",
      "--control-h: 36px", "--control-h-compact: 30px", "--page-max: 1180px", "--form-max: 720px",
    ]) expect(css).toContain(decl);
  });

  it("кегли числом остались только у двух оговорённых исключений", () => {
    const literal = [...css.matchAll(/font-size:\s*([0-9.]+)px/g)].map((m) => m[1]);
    // 10.5 и 9.5 — мелкая подпись клетки сетки и таблицы журнала; токена под неё нет намеренно.
    expect([...new Set(literal)].sort()).toEqual(["10.5", "9.5"]);
  });

  it("радиусы числом — только полоски в 2px и круг", () => {
    const literal = [...css.matchAll(/border-radius:\s*([^;]+);/g)]
      .map((m) => m[1].trim())
      .filter((v) => !v.includes("var("));
    expect(new Set(literal)).toEqual(new Set(["2px", "50%"]));
  });

  it("перед каждым color-mix стоит простое значение того же свойства", () => {
    const lines = css.split("\n");
    lines.forEach((line, i) => {
      const m = line.match(/^\s*([a-z-]+):\s*color-mix\(/);
      if (!m) return;
      expect(lines[i - 1]?.trim().startsWith(`${m[1]}:`), `строка ${i + 1}: ${line.trim()}`).toBe(true);
    });
  });
  it("серый текст на карточке читается: контраст светлой палитры не ниже 4.5", () => {
    const start = css.indexOf(":root {");
    const root = css.slice(start, css.indexOf("}", start));
    const hex = (name: string) => root.match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))![1];
    const lum = (h: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
        .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const [a, b] = [lum(hex("fallback-hint")), lum(hex("fallback-section-bg"))].sort((x, y) => y - x);
    expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5);
  });

  it("невыбранный пункт переключателя не серый --hint", () => {
    const rule = css.match(/\n\.segmented-item \{([^}]*)\}/)![1];
    expect(rule).not.toMatch(/color:\s*var\(--hint\)/);
  });
});
