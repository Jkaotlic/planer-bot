// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Тот же ответ, что отдаёт `/api/bootstrap`, с подменённым «кто я». */
function bootstrapAs(me: Partial<{ isObserver: boolean; canAnnounce: boolean; selfScheduleEnabled: boolean }>) {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, canAnnounce: false, ...me,
    },
    myShifts: { shifts: [], today: "2026-08-20" },
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

async function mountAs(me: Parameters<typeof bootstrapAs>[0]) {
  vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapAs(me) as never);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(App))); });
  await settle();
  return host;
}

/** Вкладка нижней панели: telegram-ui рисует `Tabbar.Item` не кнопкой. */
function hasTab(el: HTMLElement, label: string): boolean {
  return [...el.querySelectorAll(".tab-bar-fit *")].some((n) => (n.textContent ?? "").trim() === label);
}

describe("мини-апп глазами наблюдателя", () => {
  it("вкладок обменов и выходных нет, вкладка анонса есть", async () => {
    const el = await mountAs({ isObserver: true, canAnnounce: true });
    expect(hasTab(el, "Анонс")).toBe(true);
    expect(hasTab(el, "Обмены")).toBe(false);
    expect(hasTab(el, "Выходные")).toBe(false);
  });

  it("у обычного работника всё наоборот — правило про роль, а не про то, что вкладки исчезли у всех", async () => {
    const el = await mountAs({});
    expect(hasTab(el, "Анонс")).toBe(false);
    expect(hasTab(el, "Обмены")).toBe(true);
    expect(hasTab(el, "Выходные")).toBe(true);
  });

  // Обе проверки — на вкладке «Смены», которая открыта по умолчанию: иначе
  // «текста нет» означало бы «мы на другой вкладке», и тест не смог бы упасть.
  it("с выключенным тумблером кнопки своей смены нет", async () => {
    const el = await mountAs({ isObserver: true, selfScheduleEnabled: false });
    expect(el.textContent ?? "").not.toContain("Поставить себе смену");
  });

  it("с включённым — кнопка есть", async () => {
    const el = await mountAs({ isObserver: true, selfScheduleEnabled: true });
    expect(el.textContent ?? "").toContain("Поставить себе смену");
  });
});
