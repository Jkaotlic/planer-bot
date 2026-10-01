// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../api/client";
import { App } from "../App";

/**
 * Настройки переехали с «Смен» за шестерёнку в приветствии. Тест сквозной,
 * через `App`: данные (`me`) живут там, и только он ловит случай, когда экран
 * настроек сохранил, а приветствие на «Сменах» осталось со старым именем.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function bootstrapWith() {
  return {
    me: {
      id: 1, displayName: "Аня", address: "Аня", preferredName: null,
      isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
      isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
    },
    myShifts: { shifts: [], today: "2026-09-25" },
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
});

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
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

describe("настройки живут за шестерёнкой, а не на «Сменах»", () => {
  it("на «Сменах» нет ни одного блока настроек, есть шестерёнка", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    const el = await mount();
    expect(el.textContent).toContain("Привет, Аня");
    for (const gone of ["Напоминания о сменах", "Открывать сразу", "Календарь", "Как ко мне обращаться"]) {
      expect(el.textContent).not.toContain(gone);
    }
    expect(el.querySelector('button[aria-label="Настройки"]')).not.toBeNull();
  });

  it("шестерёнка открывает «Настройки» без таб-бара; «Назад» возвращает «Смены» с таб-баром", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    const el = await mount();
    await act(async () => (el.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click());
    await settle(3);
    expect(el.querySelector("h1")!.textContent).toBe("Настройки");
    expect(el.querySelector(".tab-bar-fit")).toBeNull();

    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    await settle(3);
    expect(el.textContent).toContain("Привет, Аня");
    expect(el.querySelector(".tab-bar-fit")).not.toBeNull();
  });

  it("обращение, сменённое в «Настройках», видно в приветствии после «Назад»", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    vi.spyOn(apiClient, "setPreferredName").mockResolvedValue({ preferredName: "Анюта", address: "Анюта" } as never);
    const el = await mount();
    await act(async () => (el.querySelector('button[aria-label="Настройки"]') as HTMLButtonElement).click());
    await settle(3);

    const input = [...el.querySelectorAll("input")].find((i) => i.type === "text") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      setter.call(input, "Анюта");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = [...el.querySelectorAll("button")].find((b) => b.textContent!.includes("Сохранить")) as HTMLButtonElement;
    await act(async () => save.click());
    await settle(5);

    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    await settle(3);
    expect(el.textContent).toContain("Привет, Анюта");
  });
});
