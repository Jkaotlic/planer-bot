// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { waitFor } from "../../test-wait";
import { App } from "../../App";

/**
 * «Сервисы» — сквозным тестом через `App`: состояние оверлеев (заказы поверх
 * «Сервисов», ссылка бота против «Открывать сразу») живёт только там.
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
  window.history.replaceState(null, "", "/");
});

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  // Ждём первого настоящего экрана, а не фиксированное число тиков: начальная загрузка тянется по-разному.
  await waitFor(() => expect(host!.textContent).not.toBe(""));
  return host;
}

const servicesButton = (el: HTMLElement) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent!.includes("Сервисы"))!;

describe("«Сервисы» в мини-аппе", () => {
  // Наблюдатель тоже открывается на «Смены» (`startTabFor` → "mine", см. observer-view.test.tsx:73).
  it("кнопка в приветствии есть у наблюдателя тоже", async () => {
    const boot = bootstrapWith();
    boot.me = { ...boot.me, isObserver: true, canAnnounce: true };
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(boot as never);
    const el = await mount();
    await waitFor(() => expect(el.textContent).toContain("Привет, Аня"));
    expect(servicesButton(el)).toBeDefined();
  });

  it("приветствие → «Сервисы» → «Заказы и опросы» → «Закрыть» возвращает в «Сервисы», «Назад» — на «Смены»", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    const el = await mount();

    await waitFor(() => expect(servicesButton(el)).toBeDefined());
    await act(async () => servicesButton(el).click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Сервисы"));
    expect(el.querySelector(".tab-bar-fit")).toBeNull();

    const food = [...el.querySelectorAll<HTMLButtonElement>(".ui-menu-row")].find((b) => b.textContent!.includes("Заказы и опросы"))!;
    await act(async () => food.click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Заказы и опросы"));

    const close = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Закрыть")!;
    await act(async () => close.click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Сервисы"));

    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    await waitFor(() => expect(el.textContent).toContain("Привет, Аня"));
  });

  it("?screen=services открывает список сразу и побеждает «Открывать сразу»", async () => {
    const boot = bootstrapWith();
    boot.me = { ...boot.me, startTab: "team" as never };
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(boot as never);
    window.history.replaceState(null, "", "/?screen=services");
    const el = await mount();
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Сервисы"));
    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    await waitFor(() => expect(el.textContent).toContain("Привет, Аня"));
  });

  it("«Сервисы» → «QR-код» → «Назад» в «Сервисы»; выбранный стиль виден при следующем открытии", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    vi.spyOn(apiClient, "setQrStyle").mockResolvedValue({ shape: "dots", color: "black" });
    const el = await mount();
    await waitFor(() => expect(servicesButton(el)).toBeDefined());
    await act(async () => servicesButton(el).click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Сервисы"));
    const qr = () => [...el.querySelectorAll<HTMLButtonElement>(".ui-menu-row")].find((b) => b.textContent!.includes("QR-код"))!;
    await act(async () => qr().click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("QR-код"));
    const dots = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Точки")!;
    await act(async () => dots.click());
    await act(async () => (el.querySelector('button[aria-label="Назад"]') as HTMLButtonElement).click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Сервисы"));
    await act(async () => qr().click());
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("QR-код"));
    const again = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Точки")!;
    expect(again.getAttribute("aria-pressed")).toBe("true");
  });

  // Список «Сервисов» лежит под заказами только когда человек пришёл из него:
  // ссылка бота ведёт в заказы напрямую, и «Закрыть» возвращает в приложение.
  it("?screen=orders закрывается на «Смены», а не в «Сервисы»", async () => {
    vi.spyOn(apiClient, "getBootstrap").mockResolvedValue(bootstrapWith() as never);
    vi.spyOn(apiClient, "getPolls").mockResolvedValue([]);
    vi.spyOn(apiClient, "getOrders").mockResolvedValue([]);
    window.history.replaceState(null, "", "/?screen=orders");
    const el = await mount();
    await waitFor(() => expect(el.querySelector("h1")!.textContent).toBe("Заказы и опросы"));
    const close = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Закрыть")!;
    await act(async () => close.click());
    await waitFor(() => expect(el.textContent).toContain("Привет, Аня"));
    expect(el.querySelector("h1")?.textContent).not.toBe("Сервисы");
  });
});
