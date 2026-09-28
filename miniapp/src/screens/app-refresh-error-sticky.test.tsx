// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * «Не получилось обновить данные» — sticky-блок наверху, общий с
 * `swapNotice` (см. коммит 393d2f2: сообщение уезжало под панель вкладок).
 * Условие показа держит оба вместе; потеря `refreshError` из него делает
 * фон неудачного фонового обновления немым — человек продолжает смотреть на
 * устаревшие данные, не зная об этом.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrap() {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
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

describe("«Не получилось обновить данные» — видна без свопа рядом", () => {
  it("фоновое обновление упало — строка появляется на экране", async () => {
    const spy = vi.spyOn(apiClient, "getBootstrap").mockResolvedValueOnce(bootstrap() as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
    await settle();

    expect(host.textContent).not.toContain("Не получилось обновить данные");

    spy.mockRejectedValueOnce(new Error("network down"));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();

    expect(host.textContent).toContain("Не получилось обновить данные");
  });
});
