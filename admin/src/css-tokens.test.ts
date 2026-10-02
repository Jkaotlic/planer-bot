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
});
