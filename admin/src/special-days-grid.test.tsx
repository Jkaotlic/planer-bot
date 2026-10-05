// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api/client";
import { App } from "./App";
import { addDays, mondayOf, toISODate } from "./lib/week";

/**
 * Название праздника в шапке колонки сетки.
 *
 * Раньше колонка просто краснела, как любой выходной, и разница между
 * воскресеньем и Днём России была видна только тому, кто помнил календарь.
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

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

// Среда показанной (текущей) недели — как у соседнего теста нехватки.
const WEDNESDAY = toISODate(addDays(mondayOf(new Date()), 2));
const SATURDAY = toISODate(addDays(mondayOf(new Date()), 5));

async function mount(calendar: Awaited<ReturnType<typeof apiClient.getDayCalendar>>) {
  vi.spyOn(apiClient, "getDayCalendar").mockResolvedValue(calendar);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

const marks = (el: HTMLElement) => [...el.querySelectorAll(".schedule-table thead th .day-col-mark")];

describe("название праздника в шапке колонки сетки", () => {
  it("шапка колонки праздника несёт значок и название", async () => {
    const el = await mount([{ date: WEDNESDAY, kind: "holiday", note: "Праздник", source: "auto" }]);
    const th = el.querySelectorAll(".schedule-table thead th")[3]!;
    expect(th.classList.contains("weekend-col")).toBe(true);
    expect(th.querySelector(".day-col-mark")?.textContent).toBe("🎉 Праздник");
    // Название — видимым текстом; `title` лишь дублирует его для усечённого.
    expect(marks(el)).toHaveLength(1);
  });

  it("рабочая суббота подписана «💼 рабочая»", async () => {
    const el = await mount([{ date: SATURDAY, kind: "workday", note: null, source: "manual" }]);
    expect(marks(el).map((n) => n.textContent)).toEqual(["💼 рабочая"]);
  });

  it("рабочий день в будни — без подписи «рабочая»", async () => {
    const el = await mount([{ date: WEDNESDAY, kind: "workday", note: null, source: "manual" }]);
    expect(el.querySelector(".day-col-mark")).toBeNull();
  });

  it("обычная неделя — без подписи", async () => {
    const el = await mount([]);
    expect(el.querySelector(".day-col-mark")).toBeNull();
  });
});
