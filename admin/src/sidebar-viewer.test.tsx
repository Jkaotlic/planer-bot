// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type Employee } from "./api/client";
import { App } from "./App";

/**
 * Подпись в футере сайдбара называет ВОШЕДШЕГО, а не первого попавшегося админа.
 *
 * Было: `employees.find((e) => e.isAdmin && e.isActive)` — то есть первый
 * активный админ в ростере. При двух админах консоль подписывалась чужим именем,
 * и человек не мог понять, под кем он вошёл. Ручка `/api/me` на сервере была всё
 * это время, ей пользовался только мини-апп.
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
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

describe("подпись в сайдбаре консоли", () => {
  it("называет вошедшего, а не первого админа в ростере", async () => {
    // Двое админов, и вошёл ВТОРОЙ. Первый в списке — Аня, значит прежний код
    // подписался бы ею.
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([
      employee({ id: 1, displayName: "Аня Первая", address: "Аня", isAdmin: true }),
      employee({ id: 2, displayName: "Игорь Второй", address: "Игорь", isAdmin: true }),
    ]);
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ id: 2, displayName: "Игорь Второй", address: "Игорь" });
    vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEvents").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);

    const el = await mount();
    const footer = el.querySelector<HTMLElement>(".sidebar-footer");

    expect(footer?.textContent).toBe("Игорь · админ");
    expect(footer?.textContent).not.toContain("Аня");
  });

  it("не сумев спросить «кто я», не врёт чужим именем", async () => {
    // Отказ `/api/me` не должен ронять консоль и не должен подставлять первого
    // админа — безымянная подпись честнее неверной.
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([
      employee({ id: 1, displayName: "Аня Первая", address: "Аня", isAdmin: true }),
    ]);
    vi.spyOn(apiClient, "getMe").mockRejectedValue(new Error("нет сети"));
    vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEvents").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);

    const el = await mount();

    expect(el.querySelector<HTMLElement>(".sidebar-footer")?.textContent).toBe("Админ");
  });
});
