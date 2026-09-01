// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "./api/client";
import { App } from "./App";

/**
 * Шторка — единственная логика мобильного захода. Ширина окна в этих тестах
 * роли не играет: за «когда шторка вообще видна» отвечает медиазапрос в CSS,
 * а здесь проверяется только состояние «открыта / закрыта». Прятать шторку
 * условным рендером по `window.innerWidth` было бы нечем проверить — в jsdom
 * медиазапросы не применяются вовсе.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function employee(patch: Partial<Employee> & { id: number; displayName: string }): Employee {
  return {
    address: patch.displayName.split(" ").at(-1) ?? patch.displayName,
    preferredName: null,
    isAdmin: false,
    isActive: true,
    telegramUserId: null,
    birthDate: null,
    excludedFromSwaps: false,
    excludedFromDistribution: false,
    ...patch,
  } as Employee;
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

async function settle(times = 15) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount() {
  vi.spyOn(apiClient, "getEmployees").mockResolvedValue([
    employee({ id: 1, displayName: "Аня Первая", address: "Аня", isAdmin: true }),
    employee({ id: 2, displayName: "Игорь Второй", address: "Игорь" }),
  ]);
  vi.spyOn(apiClient, "getMe").mockResolvedValue({ id: 1, displayName: "Аня Первая", address: "Аня" });
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getEvents").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

async function click(el: Element | null | undefined) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await settle(2);
}

function navItem(el: HTMLElement, label: string): HTMLElement | undefined {
  return Array.from(el.querySelectorAll<HTMLElement>(".sidebar-nav-item")).find((b) =>
    b.textContent?.includes(label),
  );
}

describe("шторка навигации", () => {
  it("закрыта, пока её не открыли", async () => {
    const el = await mount();

    expect(el.querySelector(".sidebar")?.className).not.toContain("open");
    expect(el.querySelector(".mobile-menu-btn")?.getAttribute("aria-expanded")).toBe("false");
    expect(el.querySelector(".sidebar-scrim")).toBeNull();
  });

  it("открывается по кнопке-гамбургеру", async () => {
    const el = await mount();

    await click(el.querySelector(".mobile-menu-btn"));

    expect(el.querySelector(".sidebar")?.className).toContain("open");
    expect(el.querySelector(".mobile-menu-btn")?.getAttribute("aria-expanded")).toBe("true");
    expect(el.querySelector(".sidebar-scrim")).not.toBeNull();
  });

  it("закрывается, когда выбрали экран, — и экран при этом меняется", async () => {
    // Оба утверждения обязательны: шторка, оставшаяся открытой поверх
    // выбранного экрана, закрывает собой ровно то, ради чего её открывали.
    const el = await mount();
    await click(el.querySelector(".mobile-menu-btn"));

    await click(navItem(el, "Настройки"));

    expect(el.querySelector(".sidebar")?.className).not.toContain("open");
    expect(el.querySelector(".sidebar-nav-item.active")?.textContent).toContain("Настройки");
  });

  it("закрывается тапом по затемнению", async () => {
    const el = await mount();
    await click(el.querySelector(".mobile-menu-btn"));

    await click(el.querySelector(".sidebar-scrim"));

    expect(el.querySelector(".sidebar")?.className).not.toContain("open");
  });

  it("закрывается по Esc", async () => {
    // Esc — единственный выход, если человек открыл шторку на планшете с
    // клавиатурой и промахнулся мимо затемнения.
    const el = await mount();
    await click(el.querySelector(".mobile-menu-btn"));

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    await settle(2);

    expect(el.querySelector(".sidebar")?.className).not.toContain("open");
  });

  it("в шапке написано, какой экран открыт", async () => {
    // Иначе на телефоне, где сайдбар спрятан, нет ни одного указания на то,
    // где человек находится.
    const el = await mount();

    expect(el.querySelector(".mobile-topbar-title")?.textContent).toBe("Расписание");

    await click(el.querySelector(".mobile-menu-btn"));
    await click(navItem(el, "Сборы"));

    expect(el.querySelector(".mobile-topbar-title")?.textContent).toBe("Сборы");
  });
});
