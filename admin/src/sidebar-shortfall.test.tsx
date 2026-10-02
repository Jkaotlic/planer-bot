// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AdminShortfall } from "@planer/shared";
import { apiClient } from "./api/client";
import { App } from "./App";

/**
 * Число нехватки на пункте «Расписание» сайдбара — проводка от ручки до метки.
 * Метка существует ради того, чтобы дыру в графике было видно, не открывая
 * расписания; поэтому здесь важны и «нет метки при нуле», и «ручка упала».
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

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

const badge = (el: HTMLElement) => el.querySelector(".sidebar-nav-badge");
const navButton = (el: HTMLElement, label: string) =>
  [...el.querySelectorAll<HTMLButtonElement>(".sidebar-nav-item")].find((b) => (b.textContent ?? "").includes(label))!;

describe("метка нехватки в сайдбаре", () => {
  it("нехватка — число на пункте «Расписание»", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    expect(badge(el)?.textContent).toBe("4");
    expect(badge(el)?.closest("button")?.textContent).toContain("Расписание");
  });

  it("нет дыр — метки нет", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 0, firstDate: null });
    expect(badge(await mount())).toBeNull();
  });

  it("ручка упала — метки нет, расписание открыто", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockRejectedValue(new Error("сеть"));
    const el = await mount();
    expect(badge(el)).toBeNull();
    expect(el.querySelector(".schedule-table")).not.toBeNull();
  });

  it("больше девяти — «9+»", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 23, firstDate: "2026-08-26" });
    expect(badge(await mount())?.textContent).toBe("9+");
  });

  it("экранному диктору число зачитывается словами, а сама метка скрыта от него", async () => {
    vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    expect(badge(el)?.getAttribute("aria-hidden")).toBe("true");
    expect(navButton(el, "Расписание").querySelector(".visually-hidden")?.textContent).toContain("не хватает людей: 4");
  });

  it("запоздавший старый ответ не затирает новое число", async () => {
    // Первый запрос (при открытии консоли) отвечает последним, уже после того,
    // как человек ушёл с «Расписания» и вернулся, — и должен быть отброшен.
    let resolveOld!: (value: AdminShortfall) => void;
    const spy = vi.spyOn(apiClient, "getAdminShortfall")
      .mockImplementationOnce(() => new Promise<AdminShortfall>((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    expect(badge(el)).toBeNull();
    await act(async () => navButton(el, "Виды смен").click());
    await settle(4);
    await act(async () => navButton(el, "Расписание").click());
    await settle(4);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(badge(el)?.textContent).toBe("4");
    await act(async () => resolveOld({ total: 1, firstDate: "2026-08-24" }));
    await settle(2);
    expect(badge(el)?.textContent).toBe("4");
  });

  it("по возвращении на «Расписание» число перечитывается", async () => {
    // Нормы правят на «Видах смен», а число в сайдбаре считает по ним.
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    const el = await mount();
    spy.mockResolvedValue({ total: 2, firstDate: "2026-08-26" });
    await act(async () => navButton(el, "Работники").click());
    await act(async () => navButton(el, "Расписание").click());
    await settle(4);
    expect(badge(el)?.textContent).toBe("2");
  });

  it("после удаления записи число перечитывается", async () => {
    // Все правки записей кончаются в `refreshSchedule`; удаление — самая короткая.
    const spy = vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 4, firstDate: "2026-08-26" });
    vi.spyOn(apiClient, "deleteEntry").mockResolvedValue({ notified: { sent: 0, failed: 0 } } as never);
    const el = await mount();
    const chip = el.querySelector<HTMLButtonElement>(".entry-chip");
    expect(chip, "в мок-графике нет ни одной записи на показанной неделе").not.toBeNull();
    await act(async () => chip!.click());
    spy.mockResolvedValue({ total: 3, firstDate: "2026-08-26" });
    const byText = (text: string) => [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === text)!;
    await act(async () => byText("Удалить").click());
    await act(async () => byText("Да, удалить").click());
    await settle(12);
    expect(badge(el)?.textContent).toBe("3");
  });
});
