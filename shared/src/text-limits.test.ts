import { describe, it, expect } from "vitest";
import { clampTelegramText, linesWord, TELEGRAM_TEXT_SAFE_MAX, tooLongText } from "./text-limits";

describe("tooLongText", () => {
  it("называет поле и потолок", () => {
    expect(tooLongText("Место", 200)).toBe("Место — не длиннее 200 знаков");
  });
});

describe("clampTelegramText", () => {
  const tail = (n: number) => `…и ещё ${n}`;

  it("короткий текст возвращает как есть, без хвоста", () => {
    const text = "Обход 47-го\n\nСвет\nОкна";
    expect(clampTelegramText(text, tail)).toBe(text);
  });

  it("длинный режет целыми строками с конца и называет, сколько скрыто", () => {
    // 30 строк по 199 знаков + перевод строки = 6000 знаков: влезает 19 строк.
    const lines = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(2, "0")}${"я".repeat(197)}`);
    const out = clampTelegramText(lines.join("\n"), tail);
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_TEXT_SAFE_MAX);
    const shown = out.split("\n").slice(0, -1);
    expect(shown).toEqual(lines.slice(0, shown.length));
    expect(out.endsWith(`\n…и ещё ${lines.length - shown.length}`)).toBe(true);
    // Влезло столько, сколько влезает: ещё одна строка уже перевалила бы предел.
    expect([...shown, lines[shown.length], tail(lines.length - shown.length - 1)].join("\n").length)
      .toBeGreaterThan(TELEGRAM_TEXT_SAFE_MAX);
  });

  it("пустые строки не считает скрытыми и не оставляет их перед хвостом", () => {
    const text = ["Заголовок", "", "а".repeat(3000), "", "б".repeat(3000), "", "Сделано 0 из 2."].join("\n");
    const out = clampTelegramText(text, tail);
    expect(out).toBe(["Заголовок", "", "а".repeat(3000), "…и ещё 2"].join("\n"));
  });

  it("за пределом одни пустые строки — режет их без хвоста «ещё 0»", () => {
    const head = "а".repeat(3990);
    expect(clampTelegramText(`${head}${"\n".repeat(20)}`, tail)).toBe(head);
  });

  // Review Focus 5: предел соблюдается, даже когда одна строка сама длиннее его.
  it("одна строка в 10 000 знаков режется по знакам и всё равно влезает", () => {
    const out = clampTelegramText("ж".repeat(10_000), tail);
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_TEXT_SAFE_MAX);
    expect(out.startsWith("жжж")).toBe(true);
    expect(out.endsWith("…\n…и ещё 1")).toBe(true);
  });

  it("длинная первая строка и ещё строки за ней — скрытой считает и обрезанную", () => {
    const out = clampTelegramText(["ж".repeat(10_000), "Свет", "Окна"].join("\n"), tail);
    expect(out.length).toBeLessThanOrEqual(TELEGRAM_TEXT_SAFE_MAX);
    expect(out.endsWith("…\n…и ещё 3")).toBe(true);
  });

  it("не разрывает пару суррогатов, отрезая строку по знакам", () => {
    const out = clampTelegramText("😀".repeat(5000), tail, 101);
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });
});

describe("linesWord", () => {
  it("склоняет «строка» по числу", () => {
    expect([1, 2, 5, 11, 21, 22, 112].map(linesWord)).toEqual([
      "1 строка", "2 строки", "5 строк", "11 строк", "21 строка", "22 строки", "112 строк",
    ]);
  });
});
