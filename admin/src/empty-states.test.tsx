// @vitest-environment jsdom
import { act, createElement, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api/client";
import { BugsScreen } from "./screens/BugsScreen";
import { ChecklistScreen } from "./screens/ChecklistScreen";
import { CollectionsScreen } from "./screens/CollectionsScreen";
import { GroupsScreen } from "./screens/GroupsScreen";
import { WeekendAdminScreen } from "./screens/WeekendAdminScreen";

// Пустой список — это ответ, а не недогруз: текст обязан лежать в блоке
// `.empty-state`, иначе он снова станет серой строчкой, которую не замечают.
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

async function mount(screen: ComponentType<never>, props: object = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(screen as ComponentType<object>, props)); });
  for (let i = 0; i < 10; i += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  return host;
}

function emptyStateWith(el: HTMLElement, text: string) {
  return [...el.querySelectorAll(".empty-state")].find((n) => (n.textContent ?? "").includes(text));
}

describe("пустые состояния консоли", () => {
  it("«Группы»: «Групп пока нет» в .empty-state", async () => {
    vi.spyOn(apiClient, "getRecipientGroups").mockResolvedValue([]);
    const el = await mount(GroupsScreen as ComponentType<never>, { employees: [] });
    expect(emptyStateWith(el, "Групп пока нет")).toBeTruthy();
  });

  it("«Сборы»: «Сборов пока не было» в .empty-state", async () => {
    vi.spyOn(apiClient, "getBirthdays").mockResolvedValue({ asOf: "2026-01-01", birthdays: [] });
    vi.spyOn(apiClient, "getCollections").mockResolvedValue([]);
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([]);
    const el = await mount(CollectionsScreen as ComponentType<never>);
    expect(emptyStateWith(el, "Сборов пока не было")).toBeTruthy();
  });

  it("«Баги»: «Открытых багрепортов нет» в .empty-state", async () => {
    vi.spyOn(apiClient, "getBugReports").mockResolvedValue([]);
    const el = await mount(BugsScreen as ComponentType<never>);
    expect(emptyStateWith(el, "Открытых багрепортов нет")).toBeTruthy();
  });

  it("«Работа в выходные»: «Нет открытых смен» в .empty-state", async () => {
    vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([]);
    const el = await mount(WeekendAdminScreen as ComponentType<never>);
    expect(emptyStateWith(el, "Нет открытых смен")).toBeTruthy();
  });

  it("«Чек-лист»: «Чек-листов пока нет» в .empty-state", async () => {
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({ date: "2026-01-01", people: [] });
    const el = await mount(ChecklistScreen as ComponentType<never>, { templates: [] });
    expect(emptyStateWith(el, "Чек-листов пока нет")).toBeTruthy();
  });
});
