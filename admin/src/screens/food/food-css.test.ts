import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../index.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const rule = (selector: string) => {
  const m = css.match(new RegExp(`(?:^|\\})\\s*${selector.replace(/[.[\]()]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m"));
  return m?.[1] ?? null;
};

describe("food-* CSS: ловушки каскада и переноса", () => {
  it("ширина цены не теряется: правило с тегом (0,1,1) — не слабее общего `input[type=\"text\"]`", () => {
    // Одиночный `.food-dish-price` (0,1,0) проигрывал `input[type="text"] { width: 100% }`.
    expect(rule("input.food-dish-price")).toMatch(/width:\s*110px/);
    expect(rule("input.food-dish-name")).toMatch(/min-width:\s*0/);
    expect(css.indexOf("input.food-dish-price")).toBeGreaterThan(css.indexOf('input[type="text"]'));
  });

  it("карточка переносит слово внутри себя, кнопка блюда — по тексту", () => {
    expect(rule(".food-card")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".food-buttons .btn")).toMatch(/white-space:\s*normal/);
  });
});
