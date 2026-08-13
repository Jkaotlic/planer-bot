import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { describe, expect, it } from "vitest";
import { CollapsibleArchive } from "./CollapsibleArchive";

/**
 * Рендер статический (`renderToStaticMarkup`), как и у остальных компонентов
 * здесь, поэтому проверяется исходное состояние: раскрытие по нажатию — один
 * `useState`, и симулировать нажатие этим способом нечем. Ловится то, из-за чего
 * секцию вообще заводили: свёрнутость по умолчанию и честный счётчик.
 */
function markup(items: string[]): string {
  return renderToStaticMarkup(
    createElement(AppRoot, {}, createElement(CollapsibleArchive<string>, {
      title: "Архив",
      items,
      children: (rows) => rows.map((row) => createElement("div", { key: row }, row)),
    })),
  );
}

describe("CollapsibleArchive", () => {
  it("свёрнут по умолчанию — содержимого в разметке нет", () => {
    const html = markup(["Аня", "Игорь"]);
    expect(html).not.toContain("Аня");
    expect(html).not.toContain("Игорь");
  });

  it("показывает, сколько там лежит, и в заголовке, и на кнопке", () => {
    const html = markup(["Аня", "Игорь"]);
    expect(html).toContain("Архив · 2");
    expect(html).toContain("Показать · 2");
  });

  it("пустой не рисуется вовсе — пустой заголовок читать незачем", () => {
    expect(markup([])).toBe(renderToStaticMarkup(createElement(AppRoot, {}, null)));
  });
});
