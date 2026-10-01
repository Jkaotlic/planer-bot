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

async function renderRow(props: { onSwap?: (s: Shift) => void; onOpen?: (s: Shift) => void }) {
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
  });

  it("раскрываемая строка доступна с клавиатуры: role=button и Enter", async () => {
    const onOpen = vi.fn();
    const el = await renderRow({ onOpen });
    const row = el.querySelector('[data-testid="shift-row"]') as HTMLElement;
    expect(row.getAttribute("role")).toBe("button");
    await act(async () => row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("Enter на «Обменять» не раскрывает строку заодно", async () => {
    const onOpen = vi.fn();
    const el = await renderRow({ onSwap: vi.fn(), onOpen });
    const swap = [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять")!;
    await act(async () => swap.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onOpen).not.toHaveBeenCalled();
  });
});
