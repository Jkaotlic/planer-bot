/// <reference types="node" />
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

/** Тело правила по селектору, без вложенных блоков (в этих правилах их нет). */
function rule(selector: string): string {
  const m = css.match(new RegExp(`(?:^|\\n)${selector.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`нет правила ${selector}`);
  return m[1]!;
}

/**
 * «＋» в клетках сетки: прежние `--hint` при opacity 0.35 / 0.3 давали с учётом
 * прозрачности 1.4–1.8:1 в обеих темах (замер 2026-10-07) — пустую клетку
 * приходилось искать глазами. Контраст считает замер в браузере, а этот тест
 * держит то, из чего он получается: основной цвет текста и непрозрачность не
 * ниже 0.6: на самых тёмных колонках 0.6 даёт ~4.55, а стоящие в CSS 0.7 — ~6.2.
 */
describe("«＋» в клетках сетки консоли читается", () => {
  for (const selector of [".empty-cell-add", ".cell-add-more"]) {
    it(`${selector}: цвет текста и непрозрачность не ниже 0.6`, () => {
      const body = rule(selector);
      expect(body).toMatch(/color:\s*var\(--text\)\s*;/);
      const opacity = Number(body.match(/opacity:\s*([0-9.]+)/)?.[1]);
      expect(opacity).toBeGreaterThanOrEqual(0.6);
    });
  }
});
