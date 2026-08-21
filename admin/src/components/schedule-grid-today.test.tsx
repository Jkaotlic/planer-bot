// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ScheduleGrid } from "./ScheduleGrid";
import type { Employee } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

const employee: Employee = {
  id: 1, displayName: "Иванов Иван", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(today?: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(ScheduleGrid, {
        employees: [employee], shifts: [], templates: [], weekDates: WEEK,
        onAddClick: () => {}, onEntryClick: () => {}, today,
      }),
    );
  });
  return host;
}

describe("сетка отмечает сегодняшний день", () => {
  /**
   * В сетке из семи одинаковых столбцов первый вопрос — «который из них
   * сегодня». До этой правки сетка отвечала только «где выходные».
   */
  it("помечает столбец сегодняшнего дня и только его", async () => {
    const el = await render("2026-06-10");
    const marked = [...el.querySelectorAll("thead th")].filter((th) => th.classList.contains("today-col"));
    expect(marked).toHaveLength(1);
    expect(marked[0]!.getAttribute("aria-current")).toBe("date");
    expect(marked[0]!.textContent).toContain("10");

    // Подсветка идёт на всю высоту столбца, а не только по шапке — иначе взгляд
    // теряет её, как только уходит вниз по людям.
    const cells = [...el.querySelectorAll("td.day-cell")].filter((td) => td.classList.contains("today-col"));
    expect(cells).toHaveLength(1);
  });

  it("не помечает ничего, когда сегодня вне показанной недели", async () => {
    const el = await render("2026-07-01");
    expect(el.querySelectorAll(".today-col")).toHaveLength(0);
  });

  it("имя работника несёт полную подпись, даже если обрезано", async () => {
    const el = await render("2026-06-10");
    expect(el.querySelector(".employee-name")!.getAttribute("title")).toBe("Иванов Иван");
  });
});
