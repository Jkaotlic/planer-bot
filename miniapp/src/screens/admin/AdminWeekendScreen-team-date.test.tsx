// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminWeekendScreen } from "./AdminWeekendScreen";

/**
 * Баг из ledger: «Учёт часов» открывался на месяце браузера
 * (`monthRange(new Date())`), а не команды — телефон в другом часовом поясе
 * (или просто рядом с полуночью на границе месяца) показывал не тот месяц по
 * умолчанию. Теперь диапазон строится из `today`, который приходит пропом из
 * bootstrap (`data.today`), а не из часов устройства.
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
  vi.useRealTimers();
});

async function settle(times = 24) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function mount(today: string) {
  vi.spyOn(apiClient, "getAdminWeekendSlots").mockResolvedValue([]);
  vi.spyOn(apiClient, "getPayroll").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminWeekendScreen, { today })));
  });
  await settle();
  return host;
}

describe("AdminWeekendScreen — учёт часов открывается на команднОМ месяце", () => {
  it("диапазон по умолчанию — месяц serverного today, не месяц телефона", async () => {
    // Телефон уверен, что уже февраль; сервер — что ещё январь.
    vi.setSystemTime(new Date("2026-02-20T12:00:00Z"));

    const el = await mount("2026-01-15");
    const dateInputs = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    expect(dateInputs).toHaveLength(2);
    expect(dateInputs[0]!.value).toBe("2026-01-01");
    expect(dateInputs[1]!.value).toBe("2026-01-31");
  });
});
