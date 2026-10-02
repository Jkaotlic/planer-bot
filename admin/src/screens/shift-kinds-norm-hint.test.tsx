// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NORM_CALENDAR_HINT } from "@planer/shared";
import { apiClient } from "../api/client";
import { ShiftKindsScreen } from "./ShiftKindsScreen";

/**
 * Правило «праздник — норма воскресенья, рабочая суббота — норма пятницы»
 * невидимо, пока не наступит праздник: редактор нормы обязан сказать о нём сразу.
 */

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

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("подсказка у нормы дня в консоли", () => {
  it("рядом с полями нормы — правило календаря", async () => {
    vi.spyOn(apiClient, "getTemplateRoles");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(ShiftKindsScreen, { employees: [] }));
    });
    await settle();
    await act(async () => (host!.querySelector(".kind-card-head") as HTMLButtonElement).click());
    await settle();
    const grid = host.querySelector(".kind-coverage")!;
    expect(grid.textContent ?? "").toContain(NORM_CALENDAR_HINT);
  });
});
