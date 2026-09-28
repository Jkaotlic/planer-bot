// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * «Своя строка в сетке недели подсвечена» (TeamWeekGrid, `meId`) держится на
 * том, что `App` действительно передаёт `TeamScreen` свой `meId` — экранный
 * тест (`team-week-me.test.tsx`) этого не видит, он монтирует `TeamWeekGrid`
 * напрямую с `meId` из пропсов.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrap() {
  return {
    me: {
      id: 2, displayName: "Смирнова Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
    },
    myShifts: { shifts: [], today: "2026-08-04" },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

describe("«Команда → Неделя» подсвечивает свою строку", () => {
  it("своя строка в сетке недели отмечена rowheader/aria-current", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrap() as never);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
      employees: [
        { id: 1, displayName: "Иванов Иван", rosterOrder: 0, excludedFromSwaps: false },
        { id: 2, displayName: "Смирнова Аня", rosterOrder: 1, excludedFromSwaps: false },
      ],
      shifts: [],
      calendar: [],
    } as never);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
    await settle();

    const teamTab = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Команда"));
    if (!teamTab) throw new Error("нет вкладки «Команда»");
    await act(async () => teamTab.click());
    await settle();

    const weekTab = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Неделя");
    if (!weekTab) throw new Error("нет переключателя «Неделя»");
    await act(async () => weekTab.click());
    await settle();

    const mine = host.querySelectorAll('[role="rowheader"][aria-current="true"]');
    expect(mine).toHaveLength(1);
    expect(mine[0]!.textContent).toContain("Смирнова");
  });
});
