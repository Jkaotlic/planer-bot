// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type Template } from "../../api/client";

/**
 * Плашка смены в строке дня рисуется двумя узлами — справа от имени и под ним, —
 * а `index.css` по ширине экрана прячет лишний (`display: none`, поэтому и
 * скринридер слышит подпись один раз). Если у одного из узлов пропадёт свой
 * класс, CSS перестанет его прятать, и на любом экране плашка встанет дважды.
 * jsdom стилей не считает, поэтому защищаем сам контракт разметки: по узлу на
 * каждый класс и подпись в обоих. Что видим ровно один, проверяет замер в
 * `ui-audit.mjs` на настоящем браузере.
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

describe("плашка смены в строке дня", () => {
  it("стоит ровно двумя узлами — по одному на каждый класс — и подпись есть в обоих", async () => {
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
      root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
    });
    await settle();

    const after = host.querySelectorAll(".entry-badge--after");
    const below = host.querySelectorAll(".entry-badge--below");
    expect(after).toHaveLength(1);
    expect(below).toHaveLength(1);
    expect(after[0]!.textContent).toContain("Утро");
    expect(below[0]!.textContent).toContain("Утро");
    // Скрывает лишний узел CSS (`display: none` выпадает и из дерева доступности).
    // `aria-hidden` на одном из них был бы ошибкой: он глушил бы плашку на той
    // ширине, где показан именно этот узел.
    expect(host.querySelectorAll(".entry-badge[aria-hidden], .entry-badge [aria-hidden]")).toHaveLength(0);
  });
});
