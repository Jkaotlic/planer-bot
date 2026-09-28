// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Фоновое обновление (возврат в приложение, смена вкладки) брало из ответа всё,
 * кроме `me`: права и запреты, поменянные админом, не доходили до открытого
 * приложения, пока его не закроешь совсем.
 */
function bootstrap(isAdmin: boolean) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
    },
    myShifts: {
      shifts: [{ id: 5, date: "2099-01-05", endDate: null, start: "08:00", end: "17:00", category: "shift", title: "Утро", templateId: null, employeeId: 1, employeeName: "Аня", location: null, note: null }],
      today: "2099-01-01",
    },
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

/** Вкладка нижней панели: telegram-ui рисует `Tabbar.Item` не кнопкой. */
function hasTab(el: HTMLElement, label: string): boolean {
  return [...el.querySelectorAll(".tab-bar-fit *")].some((n) => (n.textContent ?? "").trim() === label);
}

describe("фоновое обновление", () => {
  it("свежий `me` доезжает: человеку дали админа — вкладка «Админ» появляется без перезапуска", async () => {
    const spy = vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrap(false) as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
    await settle();
    expect(hasTab(host, "Админ")).toBe(false);

    spy.mockResolvedValue(bootstrap(true) as never);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    await settle();

    expect(hasTab(host, "Админ")).toBe(true);
  });
});
