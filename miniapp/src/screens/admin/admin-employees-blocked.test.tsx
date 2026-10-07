// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee } from "../../api/client";
import { AdminScreen } from "../AdminScreen";
import { AdminEmployeesScreen } from "./AdminEmployeesScreen";

/** Зеркало консольного теста метки «заблокировал бота». */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 14) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

describe("«Работники» мини-аппа: заблокировал бота", () => {
  it("метка есть у заблокировавшего и нет у остальных", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([
      person(1, "Аня"),
      person(2, "Игорь", { botBlockedAt: "2026-09-12T10:00:00.000Z" }),
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, {}))); });
    await settle();

    const text = host.textContent ?? "";
    expect(text).toContain("заблокировал бота с 12.09");
    expect(text.match(/заблокировал бота/g)).toHaveLength(1);
  });

  // Дата метки — по поясу команды, а не машины админа: рядом с полуночью они дают разные дни.
  // Гавайи выбраны нарочно: машина тестов в Москве, и без пояса вышло бы 12.09.
  it("день метки считается по поясу команды", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([
      person(2, "Игорь", { botBlockedAt: "2026-09-11T22:30:00.000Z" }),
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminEmployeesScreen, { teamTz: "Pacific/Honolulu" }))); });
    await settle();
    expect(host.textContent ?? "").toContain("заблокировал бота с 11.09");
  });

  // Пояс доходит от раздела «Админ» до строки работника: без этой проводки экран считал бы по поясу устройства.
  it("AdminScreen передаёт пояс команды в «Работники»", async () => {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([
      person(2, "Игорь", { botBlockedAt: "2026-09-11T22:30:00.000Z" }),
    ]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminScreen, { view: "employees", onViewChange: () => {}, today: "2026-09-12", teamTz: "Pacific/Honolulu" })));
    });
    await settle();
    expect(host.textContent ?? "").toContain("заблокировал бота с 11.09");
  });
});
