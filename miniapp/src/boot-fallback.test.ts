import { describe, expect, it } from "vitest";
// Через `?raw`, а не через node:fs: в воркспейсе мини-аппа нет типов node, а
// разметка нужна как текст — Vite отдаёт её ровно так.
import html from "../index.html?raw";

/**
 * Сторож спасательного круга из `miniapp/index.html`.
 *
 * Он существует ради одного случая: бандл собран под систему новее той, что у
 * человека, браузер не парсит модуль целиком и не выполняет из него ни строки.
 * Всё, что может тогда заговорить, — встроенный в разметку скрипт. Поэтому у
 * него два неочевидных требования, каждое из которых легко нарушить правкой,
 * выглядящей безобидно: он обязан стоять ДО модуля и быть написан синтаксисом,
 * который поймёт старый движок. Стрелочная функция или шаблонная строка внутри
 * него — и круг тонет вместе с приложением ровно там, где нужен.
 */
/** Встроенный скрипт — тот, у которого нет `type="module"`. */
function inlineScript(): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("в index.html нет встроенного скрипта");
  return match[1];
}

describe("спасательный круг загрузки", () => {
  it("стоит раньше модуля — иначе не успеет подписаться на ошибку", () => {
    const inline = html.indexOf("<script>");
    const module = html.indexOf('<script type="module"');
    expect(inline).toBeGreaterThan(-1);
    expect(module).toBeGreaterThan(-1);
    expect(inline).toBeLessThan(module);
  });

  it("полифилит Object.hasOwn — его зовёт valibot внутри Telegram SDK при старте", () => {
    expect(inlineScript()).toMatch(/Object\.hasOwn\s*=/);
  });

  it("показывает человеку сообщение и отправляет отчёт на сервер", () => {
    const code = inlineScript();
    expect(code).toContain("/api/client-error");
    expect(code).toMatch(/boot-fallback/);
  });

  // Каждый пункт ниже — реальный синтаксис, на котором старый движок бросает
  // SyntaxError и перестаёт выполнять весь скрипт, а не только эту строку.
  const forbidden: Array<[string, RegExp]> = [
    ["стрелочная функция", /=>/],
    ["const", /\bconst\s/],
    ["let", /\blet\s/],
    ["шаблонная строка", /`/],
    ["опциональная цепочка", /\?\./],
    ["нулевое слияние", /\?\?/],
    ["class", /\bclass\s/],
    ["spread", /\.\.\./],
  ];

  for (const [name, pattern] of forbidden) {
    it(`не использует ${name} — на старом движке это SyntaxError`, () => {
      expect(inlineScript()).not.toMatch(pattern);
    });
  }
});
