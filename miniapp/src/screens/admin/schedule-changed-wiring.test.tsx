// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Метка на «Админ» живёт в App и пересчитывается только по `onScheduleChanged`.
 * Нормы (правятся в «Видах смен») и импорт CSV меняют нехватку не меньше, чем
 * правка записи, — но не звали его, и число оставалось прежним до возврата в приложение.
 */

// Импорт — настоящий файловый диалог; нам нужен только вызов `onImported`.
vi.mock("./AdminRosterCsv", () => ({
  AdminRosterCsv: ({ onImported }: { onImported: () => void | Promise<void> }) =>
    createElement("button", { type: "button", "data-fake-import": true, onClick: () => void onImported() }, "Импорт"),
}));

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

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

async function mount(onScheduleChanged: () => void) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue([]);
  vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: "2026-08-26", onScheduleChanged })));
  });
  await settle();
  return host;
}

const byText = (el: HTMLElement, re: RegExp) =>
  [...el.querySelectorAll<HTMLElement>("button, [role='button'], div, span")].filter((n) => re.test(n.textContent ?? "")).pop()!;

describe("onScheduleChanged после правок, меняющих нехватку", () => {
  it("закрытие «Видов смен» (нормы могли поменяться) пересчитывает метку", async () => {
    const onScheduleChanged = vi.fn();
    const el = await mount(onScheduleChanged);
    await act(async () => el.querySelector<HTMLButtonElement>("[data-norm-unset]")!.click());
    await settle(4);
    expect(onScheduleChanged).not.toHaveBeenCalled();
    await act(async () => byText(el, /Назад к расписанию/).click());
    await settle(4);
    expect(onScheduleChanged).toHaveBeenCalledTimes(1);
  });

  it("импорт CSV пересчитывает метку после перечитывания недели", async () => {
    const onScheduleChanged = vi.fn();
    const el = await mount(onScheduleChanged);
    await act(async () => byText(el, /График файлом/).click());
    await settle(2);
    expect(onScheduleChanged).not.toHaveBeenCalled();
    await act(async () => el.querySelector<HTMLButtonElement>("[data-fake-import]")!.click());
    await settle(4);
    expect(onScheduleChanged).toHaveBeenCalledTimes(1);
  });
});
