// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type Template } from "../../api/client";

/**
 * «— не назначен —» в правке записи. Форма показывала этот выбор, но при
 * сохранении молча выбрасывала `employeeId`, а для сервера пропущенное поле —
 * «не менять»: запись оставалась у прежнего человека, хотя выбрано обратное.
 * Снять человека можно только явным `null`.
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

async function mount(shift: Shift) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
    employees: [{ ...EMPLOYEE, rosterOrder: 0 }],
    shifts: [shift],
    calendar: [],
  });
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

// `startsWith`: у выбранной строки списка в конце стоит «✓».
const buttonByText = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(text));

async function openEntry(el: HTMLElement) {
  const row = [...el.querySelectorAll<HTMLElement>("*")].find(
    (n) => n.children.length === 0 && (n.textContent ?? "").trim() === "08:00–17:00",
  );
  if (!row) throw new Error("не нашёл строку записи в дне");
  await act(async () => row.click());
  await settle(2);
}

describe("правка записи в «— не назначен —»", () => {
  it("шлёт employeeId: null и снимает человека", async () => {
    const update = vi.spyOn(apiClient, "updateEntry").mockResolvedValue({ entry: SHIFT, notified: { delivered: 0, intended: 0 } } as never);
    const el = await mount(SHIFT);
    await openEntry(el);

    await act(async () => buttonByText(el, "— не назначен —")!.click());
    await act(async () => buttonByText(el, "Сохранить")!.click());
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe(55);
    expect(update.mock.calls[0]![1].employeeId).toBeNull();
  });

  it("без смены выбора человек остаётся: шлётся его id", async () => {
    const update = vi.spyOn(apiClient, "updateEntry").mockResolvedValue({ entry: SHIFT, notified: { delivered: 0, intended: 0 } } as never);
    const el = await mount(SHIFT);
    await openEntry(el);
    await act(async () => buttonByText(el, "Сохранить")!.click());
    await settle();
    expect(update.mock.calls[0]![1].employeeId).toBe(4);
  });

  it("новая ничья запись по-прежнему создаётся (employeeId: null)", async () => {
    const create = vi.spyOn(apiClient, "createEntry").mockResolvedValue({ entry: SHIFT, notified: { delivered: 0, intended: 0 } } as never);
    const el = await mount({ ...SHIFT, date: "2026-09-24" });
    const add = [...el.querySelectorAll("button")].find((b) => /Добавить/.test(b.textContent ?? ""));
    if (!add) throw new Error("нет кнопки добавления");
    await act(async () => add.click());
    await settle(2);
    await act(async () => buttonByText(el, "— не назначен —")!.click());
    // В форме создания кнопка называется «Добавить»; та же подпись есть и в шапке экрана — нужна последняя.
    const submit = [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === "Добавить").pop()!;
    await act(async () => submit.click());
    await settle();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0].employeeId).toBeNull();
  });
});
