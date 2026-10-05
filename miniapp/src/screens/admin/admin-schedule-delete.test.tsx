// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type Template } from "../../api/client";

/**
 * «Удалить запись» — необратимое действие: снимает человека со смены, и
 * вернуть её нечем. Прямая кнопка срабатывала бы с одного тапа, а палец на
 * телефоне промахивается — отсюда `ConfirmButton` (см. его комментарий).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-23";

const TEMPLATES: Template[] = [
  { id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null, sortOrder: 1 },
];

const EMPLOYEE: Employee = {
  id: 4, displayName: "Иванов Иван", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

const SHIFT: Shift = {
  id: 55, date: TODAY, start: "08:00", end: "17:00", endDate: null,
  category: "shift", title: "Утро", location: null, note: null,
  unrecognisedCode: null, templateId: 1, employeeId: 4, employeeName: "Иванов Иван",
} as Shift;

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

async function openEdit(onScheduleChanged?: () => void) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
    employees: [{ ...EMPLOYEE, rosterOrder: 0 }],
    shifts: [SHIFT],
    calendar: [],
  });
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY, onScheduleChanged })));
  });
  await settle();

  // `EntryRow` — `Cell` из telegram-ui, а не `<button>`: клик ловится любым
  // элементом внутри неё, событие всплывает к обработчику на самой `Cell`.
  const row = [...host.querySelectorAll<HTMLElement>("*")].find(
    (el) => el.children.length === 0 && (el.textContent ?? "").trim() === "08:00–17:00",
  );
  if (!row) throw new Error("не нашёл строку записи в дне");
  await act(async () => row.click());
  await settle(2);
  return host;
}

describe("«Удалить запись» в расписании — необратимое действие спрашивает", () => {
  it("одно нажатие не удаляет запись, а сперва спрашивает", async () => {
    const del = vi.spyOn(apiClient, "deleteEntry");
    const el = await openEdit();

    const btn = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Удалить запись");
    expect(btn).toBeDefined();
    await act(async () => btn!.click());

    expect(del).not.toHaveBeenCalled();
    expect(el.textContent ?? "").toContain("Удалить эту запись из графика?");
  });

  it("подтверждённое удаление сообщает наверх, что нехватка могла измениться", async () => {
    // Метка на вкладке «Админ» живёт в App и сама графика не видит.
    const changed = vi.fn();
    vi.spyOn(apiClient, "deleteEntry").mockResolvedValue({ notified: { delivered: 0, intended: 0 } } as never);
    const el = await openEdit(changed);
    const ask = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Удалить запись")!;
    await act(async () => ask.click());
    const yes = [...el.querySelectorAll("button")].find((b) => /^Да|Удалить$/.test((b.textContent ?? "").trim()) && b !== ask);
    expect(yes).toBeDefined();
    await act(async () => yes!.click());
    await settle();
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
