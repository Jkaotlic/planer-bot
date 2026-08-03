// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../api/client";
import { WeekendAdminScreen } from "./WeekendAdminScreen";

/**
 * Зеркало теста мини-аппа (`miniapp/src/screens/admin/payroll-error.test.tsx`) —
 * `PayrollSection` в обоих приложениях одинаковый, и отказы из него уходили в
 * общий `error` наверху экрана, над списком слотов.
 *
 * В консоли это упирается в высоту окна позже, чем на телефоне (замер 1440×900 с
 * двумя слотами: страница ровно 900px, кнопки учёта на y=836 — то есть третий
 * слот уже выносит их за край), но код и дефект те же самые.
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

async function settle(times = 20) {
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
    root!.render(createElement(WeekendAdminScreen));
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

describe("отказ «Учёта часов» остаётся в «Учёте часов» (консоль)", () => {
  it("«Показать» получил отказ — причина написана там же, а не над списком слотов", async () => {
    const el = await mount();
    const show = button(el, "Показать");

    vi.spyOn(apiClient, "getPayroll").mockRejectedValue(new Error("Failed to fetch"));
    await act(async () => show.click());
    await settle();

    const error = el.querySelector(".employees-error");
    expect(error).toBeTruthy();
    expect(follows(error!, show)).toBe(true);
  });
});
