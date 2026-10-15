// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type Template } from "../../api/client";

/**
 * Смена на человеке, который в этот день болеет, в списке дня подписана «ждёт
 * замены»: нехватка её уже не считает закрытой (`waitsForCover`), и строка,
 * выглядящая как обычная смена, спорила бы с подсказкой «Не хватает».
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-23";

const TEMPLATES: Template[] = [
  { id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null, sortOrder: 1 },
];

const EMPLOYEE: Employee = {
  id: 4, displayName: "Иванов Игорь", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Игорь",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

const MORNING = {
  id: 55, date: TODAY, start: "08:00", end: "17:00", endDate: null,
  category: "shift", title: "Утро", location: null, note: null,
  unrecognisedCode: null, templateId: 1, employeeId: 4, employeeName: "Иванов Игорь",
} as Shift;

const SICK = {
  id: 56, date: "2026-09-22", start: null, end: null, endDate: "2026-09-24",
  category: "sick_leave", title: null, location: null, note: null,
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

async function mount(shifts: Shift[]) {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
    employees: [{ ...EMPLOYEE, rosterOrder: 0 }],
    shifts,
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

describe("смена на больном в списке дня", () => {
  it("подписана «ждёт замены»", async () => {
    const el = await mount([MORNING, SICK]);
    expect(el.textContent ?? "").toContain("Иванов Игорь");
    expect(el.textContent ?? "").toContain("ждёт замены");
  });

  it("у здорового подписи нет", async () => {
    const el = await mount([MORNING]);
    expect(el.textContent ?? "").toContain("Иванов Игорь");
    expect(el.textContent ?? "").not.toContain("ждёт замены");
  });
});
