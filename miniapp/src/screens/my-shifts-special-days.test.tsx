// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MyShiftsScreen } from "./MyShiftsScreen";
import type { Me, Shift } from "../api/client";

/**
 * «Мои смены»: смена, выпавшая на праздник или рабочую субботу, подписана
 * текстом в самой строке — человек не должен сверять дату с календарём.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const me: Me = {
  id: 7, displayName: "Игорь Петров", address: "Игорь", preferredName: null,
  isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
};

let nextId = 1;
function entry(date: string): Shift {
  return {
    id: nextId++, date, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title: "День", location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 7,
  } as Shift;
}

async function renderScreen(shifts: Shift[], calendar?: { date: string; kind: "holiday" | "workday"; note: string | null }[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const screen = createElement(MyShiftsScreen, {
    me, today: "2026-08-05", shifts, templates: [], calendar,
    onProposeSwap: () => {}, onSelfEntry: () => {}, onOpenSettings: () => {}, onOpenServices: () => {},
    openDay: null, openDayLoading: false, openDayError: null, onToggleCoworkers: () => {},
  });
  await act(async () => root!.render(createElement(AppRoot, null, screen)));
  return [...host.querySelectorAll<HTMLElement>('[data-testid="shift-row"]')];
}

describe("«Мои смены» и календарь праздников", () => {
  it("смена в праздник несёт значок и название, соседняя — нет", async () => {
    const rows = await renderScreen(
      [entry("2026-08-06"), entry("2026-08-07")],
      [{ date: "2026-08-06", kind: "holiday", note: "Праздник" }],
    );
    expect(rows[0]!.querySelector("[data-special-day]")?.textContent).toBe("🎉 Праздник");
    expect(rows[1]!.querySelector("[data-special-day]")).toBeNull();
  });

  it("смена в рабочую субботу помечена 💼", async () => {
    const rows = await renderScreen([entry("2026-08-08")], [{ date: "2026-08-08", kind: "workday", note: null }]);
    expect(rows[0]!.querySelector("[data-special-day]")?.textContent).toBe("💼 рабочая");
  });

  it("без поля calendar (ответ старого сервера) экран не падает и ничего не помечает", async () => {
    const rows = await renderScreen([entry("2026-08-06")], undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.querySelector("[data-special-day]")).toBeNull();
  });
});

describe("App → «Мои смены»: календарь доезжает из bootstrap", () => {
  it("праздник из `myShifts.calendar` подписан у смены на вкладке", async () => {
    const { apiClient } = await import("../api/client");
    const { App } = await import("../App");
    const { vi } = await import("vitest");
    const shift = { ...entry("2026-08-06"), employeeId: 1 };
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue({
      me: { ...me, id: 1 },
      myShifts: { shifts: [shift], today: "2026-08-05", calendar: [{ date: "2026-08-06", kind: "holiday", note: "Праздник" }] },
      teamSchedule: { shifts: [], employees: [], calendar: [] },
      templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
    } as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(AppRoot, null, createElement(App))));
    for (let i = 0; i < 20; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 25)); });
    expect(host.querySelector("[data-special-day]")?.textContent).toBe("🎉 Праздник");
    vi.restoreAllMocks();
  });
});
