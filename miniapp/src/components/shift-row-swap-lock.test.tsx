// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Shift } from "../api/client";
import { ShiftRow } from "./ShiftRow";

/**
 * Пропавшая кнопка читается как поломка, погашенная — как правило.
 *
 * Это не вкусовщина: мини-апп — один длинный скролл, и «кнопки просто нет»
 * человеку неотличимо от «экран не догрузился». Поэтому кнопка остаётся на
 * месте, гаснет и несёт фразу, объясняющую запрет.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHIFT: Shift = {
  id: 1, date: "2026-08-13", start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: "День", location: null, templateId: 2,
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

async function mount(props: { onSwap: (shift: Shift) => void; swapBlockedReason?: string }) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(ShiftRow, { shift: SHIFT, templates: [], ...props })));
  });
  return host;
}

function swapButton(el: HTMLElement): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Обменять"));
  if (!found) throw new Error("кнопки «Обменять» нет на строке");
  return found as HTMLButtonElement;
}

describe("ShiftRow под запретом обменов", () => {
  it("кнопка не исчезает, а гаснет с пояснением и не срабатывает", async () => {
    const onSwap = vi.fn();
    const el = await mount({ onSwap, swapBlockedReason: "Обмены сейчас закрыты" });

    expect(el.textContent ?? "").toContain("Обмены сейчас закрыты");
    await act(async () => swapButton(el).click());
    expect(onSwap).not.toHaveBeenCalled();
  });

  it("без запрета кнопка активна и зовёт onSwap", async () => {
    const onSwap = vi.fn();
    const el = await mount({ onSwap });

    await act(async () => swapButton(el).click());
    expect(onSwap).toHaveBeenCalledTimes(1);
  });
});
