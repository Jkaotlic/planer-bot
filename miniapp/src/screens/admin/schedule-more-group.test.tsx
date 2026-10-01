// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient } from "../../api/client";

/**
 * Пять кнопок под днём раньше были равными; теперь «Добавить» одна главная,
 * «Заполнить неделю» обычная, а редкое — файл, «Кто что может», «Виды смен» —
 * лежит в группе «Ещё». Тест держит и состав группы, и то, что строка ведёт
 * на тот же вложенный экран, что и прежняя кнопка.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-23";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function mount() {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [], shifts: [], calendar: [] });
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const menuRows = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button.ui-menu-row")];

describe("«Расписание»: группа «Ещё»", () => {
  it("три строки меню с прежними подписями, без эмодзи в названии", async () => {
    const el = await mount();
    expect([...el.querySelectorAll("h2")].some((h) => h.textContent === "Ещё")).toBe(true);
    expect(menuRows(el).map((b) => b.querySelector(".ui-menu-row__title")?.textContent)).toEqual([
      "График файлом (CSV)",
      "Кто что может",
      "Виды смен",
    ]);
  });

  it("«Виды смен» открывает тот же экран, что и прежняя кнопка", async () => {
    const el = await mount();
    const row = menuRows(el).find((b) => (b.textContent ?? "").includes("Виды смен"))!;
    await act(async () => row.click());
    await settle(3);
    // Заголовок вложенного экрана настроек видов смен; экран файла назывался бы «График файлом».
    expect([...el.querySelectorAll("*")].some((n) => n.children.length === 0 && n.textContent === "Виды смен" && !n.closest(".ui-menu-row"))).toBe(true);
    expect(el.textContent).not.toContain("График файлом");
    expect(menuRows(el)).toHaveLength(0);
  });

  it("главная кнопка на экране дня одна — «Добавить»", async () => {
    const el = await mount();
    const primary = [...el.querySelectorAll<HTMLButtonElement>("button.ui-btn--primary")];
    expect(primary.map((b) => (b.textContent ?? "").trim())).toEqual(["＋ Добавить"]);
  });
});
