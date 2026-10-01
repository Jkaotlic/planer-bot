// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
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

  // Вид один: раньше был второй, на Section telegram-ui, с фоном под голые строки.
  // Классы telegram-ui хешируются, так что «нет Section» по имени класса не
  // проверить; честный признак — что корень секции наш `ui-group`.
  it("тело — Group общего набора", () => {
    const html = markup(["Аня"]);
    expect(html).toContain('class="ui-group"');
  });

  it("кнопка раскрытия сообщает скринридеру, что секция свёрнута", () => {
    expect(markup(["Аня"])).toContain('aria-expanded="false"');
  });
});

describe("CollapsibleArchive: раскрытие", () => {
  it("после нажатия aria-expanded=true и строки на месте", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(AppRoot, {}, createElement(CollapsibleArchive<string>, {
        title: "Архив", items: ["Аня"], children: (rows) => rows.map((r) => createElement("div", { key: r }, r)),
      })));
    });
    const btn = host.querySelector("button") as HTMLButtonElement;
    await act(async () => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("Аня");
    await act(async () => root.unmount());
    host.remove();
  });
});
