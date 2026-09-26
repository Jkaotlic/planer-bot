// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * Телефон и сервер расходятся по часам ровно там, где это дорого — около
 * полуночи. «Команда → Сегодня» обязана показывать день из bootstrap
 * (`myShifts.today`), а не то, что думают часы телефона.
 *
 * Даты выбраны не случайно: 5 октября 2026 — понедельник, 4 октября —
 * воскресенье ПРОШЛОЙ недели. Разница не «на день», а на всю неделю, поэтому
 * останься внутри `TeamScreen` хоть один `new Date()` — тест это заметит.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrapWith(today: string) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false, startTab: null,
    },
    myShifts: { shifts: [], today },
    teamSchedule: { shifts: [], employees: [] },
    templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

describe("«Команда → Сегодня» — командная дата, а не часы телефона", () => {
  it("телефон уже 5 октября, сервер говорит «сегодня 4-е» — Команда показывает 4 октября", async () => {
    // Только `Date` подменяется: реальные таймеры остаются реальными — на них
    // держится и `settle()`, и задержки мока API.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 5, 0, 30));
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith("2026-10-04") as never);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);

    const el = await mount();
    const teamTab = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Команда"));
    if (!teamTab) throw new Error("нет вкладки «Команда»");
    await act(async () => teamTab.click());
    await settle();

    expect(el.textContent).toContain("4 октября");
    expect(el.textContent).not.toContain("5 октября");
  });
});
