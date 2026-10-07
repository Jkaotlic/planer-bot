// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ShiftRow } from "./ShiftRow";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const shift = {
  id: 5, date: "2026-10-03", start: "11:00", end: "20:00", endDate: null, category: "shift",
  title: "Вечер", location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 1,
} as Shift;

async function renderRow(props: { onSwap?: (s: Shift) => void; onOpen?: (s: Shift) => void; expanded?: boolean }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(ShiftRow, { shift, templates: [], ...props })));
  });
  return host;
}

describe("строка смены: два разных нажатия", () => {
  it("«Обменять» открывает обмен и НЕ раскрывает строку", async () => {
    const onSwap = vi.fn();
    const onOpen = vi.fn();
    const el = await renderRow({ onSwap, onOpen });
    const swap = [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять")!;
    await act(async () => swap.click());
    expect(onSwap).toHaveBeenCalledWith(shift);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("нажатие на строку раскрывает её и НЕ открывает обмен", async () => {
    const onSwap = vi.fn();
    const onOpen = vi.fn();
    const el = await renderRow({ onSwap, onOpen });
    await act(async () => (el.querySelector('[data-testid="shift-row"]') as HTMLElement).click());
    expect(onOpen).toHaveBeenCalledWith(shift);
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("строка без onOpen не притворяется кнопкой", async () => {
    const el = await renderRow({});
    const row = el.querySelector('[data-testid="shift-row"]') as HTMLElement;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.getAttribute("tabindex")).toBeNull();
    expect(el.querySelector(".shift-row__toggle")).toBeNull();
  });

  it("раскрываемая строка сообщает, раскрыта ли она, на своей кнопке; нераскрываемая — ничего", async () => {
    const closed = await renderRow({ onOpen: vi.fn() });
    expect(closed.querySelector(".shift-row__toggle")!.getAttribute("aria-expanded")).toBe("false");
    await act(async () => root!.unmount());
    host!.remove();
    const open = await renderRow({ onOpen: vi.fn(), expanded: true });
    expect(open.querySelector(".shift-row__toggle")!.getAttribute("aria-expanded")).toBe("true");
    await act(async () => root!.unmount());
    host!.remove();
    const plain = await renderRow({ expanded: true });
    expect(plain.querySelector('[data-testid="shift-row"]')!.hasAttribute("aria-expanded")).toBe(false);
    expect(plain.querySelector("[aria-expanded]")).toBeNull();
  });

  it("раскрывающий контрол — настоящая <button>, а строка не role=button: вложенной интерактивности нет", async () => {
    const el = await renderRow({ onSwap: vi.fn(), onOpen: vi.fn() });
    const row = el.querySelector('[data-testid="shift-row"]') as HTMLElement;
    expect(row.getAttribute("role")).toBeNull();
    expect(row.hasAttribute("tabindex")).toBe(false);
    const toggle = el.querySelector(".shift-row__toggle") as HTMLElement;
    expect(toggle.tagName).toBe("BUTTON");
    // Ни кнопка в кнопке, ни кнопка в role=button: «Обменять» — соседка, не потомок.
    expect(el.querySelector('button button, [role="button"] button, button [role="button"]')).toBeNull();
    expect(toggle.contains([...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять")!)).toBe(false);
  });

  it("нажатие на раскрывающую кнопку зовёт onOpen ровно один раз", async () => {
    const onOpen = vi.fn();
    const el = await renderRow({ onOpen });
    await act(async () => (el.querySelector(".shift-row__toggle") as HTMLElement).click());
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // Enter/пробел на настоящей <button> браузер превращает в `click`, который всплывает к строке:
  // не дать ему раскрыть строку заодно с обменом — дело `stopPropagation` в `SwapChip`.
  it("нажатие «Обменять» (в том числе с клавиатуры — это click) не раскрывает строку заодно", async () => {
    const onOpen = vi.fn();
    const onSwap = vi.fn();
    const el = await renderRow({ onSwap, onOpen });
    const swap = [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять")!;
    await act(async () => swap.click());
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("раскрываемая строка несёт класс с видимой рамкой фокуса", async () => {
    const el = await renderRow({ onOpen: vi.fn() });
    expect(el.querySelector('[data-testid="shift-row"]')!.classList.contains("shift-row")).toBe(true);
    expect(el.querySelector(".shift-row__toggle")).not.toBeNull();
  });
});
