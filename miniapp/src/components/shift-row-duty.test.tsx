// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ShiftRow } from "./ShiftRow";

/**
 * Дежурством можно меняться с 2026-08-10, значит кнопка на его строке обязана
 * быть: её отсутствие — это «фича есть, но до неё не дойти».
 *
 * Рядом с сторожем на отпуск: правило берётся из shared, и проверяем мы, что
 * строка спрашивает именно его, а не «категория равна shift».
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BASE: Shift = {
  id: 1, date: "2026-08-13", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "Дежурство · Поклонка", location: "Поклонка", templateId: 2,
  employeeId: 1, unrecognisedCode: null,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(shift: Shift) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null, createElement(ShiftRow, { shift, templates: [], onSwap: vi.fn() })),
    );
  });
  return host;
}

const swapButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять") ?? null;

describe("ShiftRow и обмен", () => {
  it("на дежурстве кнопка «Обменять» есть", async () => {
    expect(swapButton(await mount({ ...BASE, category: "duty" }))).not.toBeNull();
  });

  it("на отпуске — нет", async () => {
    expect(swapButton(await mount({ ...BASE, category: "vacation", start: null, end: null, title: null }))).toBeNull();
  });
});
