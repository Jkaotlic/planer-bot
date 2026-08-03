// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminWeekendScreen } from "./AdminWeekendScreen";

/**
 * «Учёт часов» — самая нижняя секция экрана «Выходные», а её отказы уходили в
 * общий `error` под кнопкой «Открыть смену», то есть наверх.
 *
 * Замер в Chromium 390×844 (DEV-мок, два слота): чтобы дотянуться до «Показать»,
 * экран надо прокрутить на 552px — кнопка оказывается на y=563, а блок ошибки на
 * **y=−368**, сотни пикселей выше края. Админ нажал, таблица не обновилась,
 * почему — не сказано нигде.
 *
 * Тест держит то же без пикселей: отказ обязан лежать ПОСЛЕ кнопки, которую
 * нажали, а не перед всем списком слотов.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 24) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminWeekendScreen)));
  });
  await settle();
  return host;
}

function button(el: HTMLElement, label: string): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!found) throw new Error(`нет кнопки «${label}»`);
  return found as HTMLElement;
}

function follows(node: Node, after: Node): boolean {
  return (after.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("отказ «Учёта часов» остаётся в «Учёте часов»", () => {
  it("«Показать» получил отказ — причина написана там же, а не над списком слотов", async () => {
    const el = await mount();
    const show = button(el, "Показать");

    vi.spyOn(apiClient, "getPayroll").mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => show.click());
    await settle();

    const error = [...el.querySelectorAll("div")].find(
      (d) => d.children.length === 0 && (d.textContent ?? "").includes("Failed to fetch"),
    );
    expect(error).toBeTruthy();
    expect(follows(error!, show)).toBe(true);
  });
});
