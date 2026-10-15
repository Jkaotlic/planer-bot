// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type Template } from "../../api/client";

/**
 * Отпуск 12–17, сокращённый в форме до одного дня. Форма слала `PATCH` без
 * `endDate`, а для сервера пропущенное поле — «не менять»: ответ 200, отпуск
 * остаётся 12–17. Однодневную полосу у правки называют явным `null`.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-10-15";

const TEMPLATES: Template[] = [
  { id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null, sortOrder: 1 },
];

const EMPLOYEE: Employee = {
  id: 4, displayName: "Иванов Игорь", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Игорь",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

const VACATION = {
  id: 77, date: "2026-10-12", start: null, end: null, endDate: "2026-10-17",
  category: "vacation", title: null, location: null, note: null,
  unrecognisedCode: null, templateId: null, employeeId: 4, employeeName: "Иванов Игорь",
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

async function mount() {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
    employees: [{ ...EMPLOYEE, rosterOrder: 0 }],
    shifts: [VACATION],
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

async function setInput(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("правка отпуска, сокращённого до одного дня", () => {
  it("шлёт endDate: null — иначе сервер оставляет старый конец", async () => {
    const update = vi.spyOn(apiClient, "updateEntry").mockResolvedValue({ entry: VACATION, notified: { delivered: 0, intended: 0 } } as never);
    const el = await mount();
    const name = [...el.querySelectorAll<HTMLElement>("*")].find(
      (n) => n.children.length === 0 && (n.textContent ?? "").trim() === "Иванов Игорь",
    );
    if (!name) throw new Error("не нашёл строку отпуска в дне");
    await act(async () => name.click());
    await settle(2);

    const toField = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')].find((i) => i.value === "2026-10-17");
    if (!toField) throw new Error("нет поля «По» со значением конца отпуска");
    await setInput(toField, "2026-10-12");
    const save = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Сохранить");
    await act(async () => save!.click());
    await settle();

    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0]![0]).toBe(77);
    expect(update.mock.calls[0]![1]).toMatchObject({ category: "vacation", date: "2026-10-12" });
    expect(update.mock.calls[0]![1]).toHaveProperty("endDate", null);
  });
});
