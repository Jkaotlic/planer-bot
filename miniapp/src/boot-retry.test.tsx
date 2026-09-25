// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "./api/client";
import { App } from "./App";

/**
 * «Повторить» на экране ошибки загрузки: у админки эта кнопка была с первого
 * дня (`admin/src/App.tsx`), а мини-апп открывают через медленный релей
 * KeenDNS, где первая попытка падает чаще, чем на обычном интернете, — без
 * кнопки единственный выход был полностью перезагрузить страницу.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const BOOTSTRAP_FIXTURE = {
  me: {
    id: 1, displayName: "Аня", address: "Аня", preferredName: null,
    isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
    isObserver: false, selfScheduleEnabled: false, canAnnounce: false,
  },
  myShifts: { shifts: [], today: "2026-08-20" },
  teamSchedule: { shifts: [], employees: [] },
  templates: [], swaps: [], weekendSlots: [], weekendOffers: [],
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

describe("экран ошибки загрузки", () => {
  it("«Повторить» запрашивает bootstrap заново и открывает приложение", async () => {
    const getBootstrap = vi
      .spyOn(apiClient, "getBootstrap")
      .mockRejectedValueOnce(new Error("Не удалось загрузить данные"))
      .mockResolvedValueOnce(BOOTSTRAP_FIXTURE as never);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(App)));
    });
    await settle();

    expect(host.textContent).toContain("Не удалось загрузить");

    const retryButton = [...host.querySelectorAll("button")].find(
      (b) => (b.textContent ?? "").trim() === "Повторить",
    ) as HTMLButtonElement | undefined;
    expect(retryButton).toBeTruthy();

    await act(async () => retryButton!.click());
    await settle();

    expect(host.textContent).toContain("Привет");
    expect(getBootstrap).toHaveBeenCalledTimes(2);
  });
});
