// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleArchive } from "./CollapsibleArchive";

/**
 * Секция с прошедшим. Тесты здесь — с настоящим нажатием (jsdom), в отличие от
 * близнеца в мини-аппе, где рендер статический: раскрытие проверяется целиком,
 * а не только исходное состояние.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(items: string[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      createElement(CollapsibleArchive<string>, {
        title: "Архив",
        items,
        children: (rows) => createElement("div", null, rows.map((row) => createElement("p", { key: row }, row))),
      }),
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe("CollapsibleArchive", () => {
  it("свёрнут по умолчанию — содержимого в документе нет", () => {
    const el = render(["Аня", "Игорь"]);
    expect(el.textContent).toContain("Архив · 2");
    expect(el.textContent).not.toContain("Аня");
    expect(el.querySelector(".archive-toggle")?.getAttribute("aria-expanded")).toBe("false");
  });

  it("раскрывается по нажатию и сворачивается обратно", () => {
    const el = render(["Аня", "Игорь"]);
    const toggle = el.querySelector<HTMLButtonElement>(".archive-toggle")!;

    act(() => toggle.click());
    expect(el.textContent).toContain("Аня");
    expect(el.textContent).toContain("Игорь");
    expect(el.querySelector(".archive-toggle")?.getAttribute("aria-expanded")).toBe("true");

    act(() => el.querySelector<HTMLButtonElement>(".archive-toggle")!.click());
    expect(el.textContent).not.toContain("Аня");
  });

  it("пустой не рисуется вовсе — пустой заголовок читать незачем", () => {
    expect(render([]).innerHTML).toBe("");
  });
});
