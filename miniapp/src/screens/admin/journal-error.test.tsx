// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminJournal } from "./AdminJournal";

/**
 * Зеркало теста консоли (`admin/src/screens/journal-error.test.tsx`) — дефект
 * жил в обоих приложениях одинаково.
 *
 * Ошибка рисовалась ВМЕСТО всего содержимого вкладки, вместе с фильтрами и
 * кнопками страниц, а эффект перечитывает журнал только когда меняются фильтр
 * или страница — то есть ровно те органы управления, которые ошибка и убрала.
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

async function settle(times = 16) {
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
    root!.render(createElement(AppRoot, null, createElement(AdminJournal, { today: "2026-08-03" })));
  });
  await settle();
  return host;
}

function byText(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll("button, [role='button']")].find(
    (node) => (node.textContent ?? "").trim() === text,
  );
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

describe("«Кто менял» после отказа возвращается без перезапуска мини-аппа", () => {
  it("упавший журнал даёт «Повторить», и после него показывает события", async () => {
    const el = await mount();
    const failing = vi.spyOn(apiClient, "getJournal").mockRejectedValue(new Error("Failed to fetch"));

    await click(byText(el, "Кто менял"));
    expect(el.textContent ?? "").toContain("Failed to fetch");

    failing.mockRestore();
    await click(byText(el, "Повторить"));

    expect(el.textContent ?? "").not.toContain("Failed to fetch");
    expect(el.querySelectorAll("select").length).toBeGreaterThan(0);
  });
});
