// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Shift } from "./api/client";
import { App } from "./App";

/**
 * Листание недели в консоли: пока ответ новой недели в пути, сетка не вправе
 * держать записи прежней под датами новой (B13) — вместо неё «Загрузка…».
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

async function settle(times = 12) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("консоль: листание недели", () => {
  it("пока грузится следующая неделя, сетки прежней нет, а есть «Загрузка…»", async () => {
    const original = apiClient.getTeamSchedule.bind(apiClient);
    let calls = 0;
    let release!: (value: Shift[]) => void;
    const pending = new Promise<Shift[]>((resolve) => { release = resolve; });
    vi.spyOn(apiClient, "getTeamSchedule").mockImplementation((from, to) => {
      calls += 1;
      return calls === 1 ? original(from, to) : pending;
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(App)); });
    await settle();
    expect(host.querySelector(".schedule-table")).not.toBeNull();

    await act(async () => (host!.querySelector("[aria-label='Следующая неделя']") as HTMLElement).click());
    await settle(4);
    expect(host.querySelector(".schedule-table")).toBeNull();
    expect(host.textContent ?? "").toContain("Загрузка…");

    release([]);
    await settle();
    expect(host.querySelector(".schedule-table")).not.toBeNull();
  });
});
