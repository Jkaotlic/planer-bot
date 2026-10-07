// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type Shift, type TeamSchedule, type Template, type TemplateRolesView } from "../../api/client";

/**
 * Листание недели в мобильной админке: пока ответ новой недели в пути, на экране
 * не должно быть ни записей прежней недели под новой датой, ни фразы «ничего не
 * запланировано» про день, который просто ещё не прочитан (B13). Там же — «Повторить»
 * для упавшей загрузки людей/видов/норм (B14) и подпись праздника в `aria-label` клетки (B15).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-09-23"; // среда
const NEXT_WEEK_DAY = "2026-09-30";

const TEMPLATES: Template[] = [
  { id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true, category: "shift", location: null, sortOrder: 1 },
];
const EMPLOYEE: Employee = {
  id: 4, displayName: "Иванов Иван", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};
const SHIFT = {
  id: 55, date: TODAY, start: "08:00", end: "17:00", endDate: null,
  category: "shift", title: "Утро", location: null, note: null,
  unrecognisedCode: null, templateId: 1, employeeId: 4, employeeName: "Иванов Иван",
} as Shift;
// Норма «Утро» по будням — 1 человек, чтобы у пустой недели была нехватка и плашка.
const ROLES: TemplateRolesView[] = [{
  templateId: 1, name: "Утро", category: "shift", accent: "gold", checklistIds: [], sendReminder: false, reminderText: null,
  coverage: [1, 1, 1, 1, 1, 0, 0], pool: [4], preference: {},
}];

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

function baseMocks() {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(ROLES);
  vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: [] });
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const EMPTY_DAY = "В этот день пока ничего не запланировано";

describe("листание недели не показывает чужие записи и ложную пустоту", () => {
  it("пока грузится следующая неделя, записей прежней нет и «ничего не запланировано» не пишется", async () => {
    const week1: TeamSchedule = { employees: [], shifts: [SHIFT], calendar: [] };
    let release!: (value: TeamSchedule) => void;
    const week2 = new Promise<TeamSchedule>((resolve) => { release = resolve; });
    baseMocks();
    vi.spyOn(apiClient, "getTeamSchedule").mockImplementation((from) => (from === "2026-09-21" ? Promise.resolve(week1) : week2));
    const el = await mount();
    expect(el.textContent ?? "").toContain("08:00–17:00");

    await act(async () => (el.querySelector("[aria-label='Следующая неделя']") as HTMLElement).click());
    await settle();

    // Ответ следующей недели ещё не пришёл: ни запись прошлой недели, ни ложная пустота.
    expect(el.textContent ?? "").not.toContain("08:00–17:00");
    expect(el.textContent ?? "").not.toContain(EMPTY_DAY);

    release({ employees: [], shifts: [], calendar: [] });
    await settle();
    expect(el.textContent ?? "").toContain(EMPTY_DAY);
    expect(NEXT_WEEK_DAY).toBe("2026-09-30");
  });
});

describe("упавшая загрузка людей, видов и норм обратима", () => {
  it("«Повторить» перечитывает данные, и плашка нехватки появляется", async () => {
    baseMocks();
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [], shifts: [], calendar: [] });
    const failing = vi.spyOn(apiClient, "getTemplateRoles").mockRejectedValueOnce(new Error("Failed to fetch"));
    const el = await mount();
    expect(el.textContent ?? "").toContain("Failed to fetch");
    const retry = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Повторить");
    expect(retry, "нет кнопки «Повторить»").toBeTruthy();

    failing.mockResolvedValue(ROLES);
    await act(async () => retry!.click());
    await settle();

    expect(el.textContent ?? "").not.toContain("Failed to fetch");
    expect(el.querySelector("[data-day-short]"), "после повтора метки нехватки на днях").toBeTruthy();
  });
});

describe("подпись клетки дня", () => {
  it("называет праздник и рабочую субботу", async () => {
    baseMocks();
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
      employees: [], shifts: [],
      calendar: [
        { date: "2026-09-22", kind: "holiday", note: null, source: "manual" },
        { date: "2026-09-26", kind: "workday", note: null, source: "manual" },
      ],
    } as TeamSchedule);
    const el = await mount();
    const labels = [...el.querySelectorAll<HTMLElement>("[data-day-chip]")].map((b) => b.getAttribute("aria-label") ?? "");
    expect(labels.find((l) => l.includes("22"))).toContain("праздник");
    expect(labels.find((l) => l.includes("26"))).toContain("рабочая суббота");
    expect(labels.find((l) => l.includes("23"))).not.toMatch(/праздник|рабочая/);
  });
});

describe("подсказка дня и «Знаю про дату»", () => {
  it("пока ответ об отметках не пришёл, закрытый день не показывает подсказку нехватки", async () => {
    let release!: (value: { dates: string[] }) => void;
    const acks = new Promise<{ dates: string[] }>((resolve) => { release = resolve; });
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
    vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(ROLES);
    vi.spyOn(apiClient, "getCoverageAcks").mockReturnValue(acks);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [], shifts: [], calendar: [] });
    const el = await mount();
    // Записей нет, норма есть — день недобран, но отметки ещё неизвестны.
    expect(el.querySelector('[role="status"]:not(.ui-shortfall)')).toBeNull();

    release({ dates: ["2026-09-23"] });
    await settle();
    expect(el.querySelector('[role="status"]:not(.ui-shortfall)')).toBeNull(); // отмечен — молчит и после

    // Контроль: без отметки подсказка после ответа есть, иначе тест ничего не доказывает.
    await act(async () => root!.unmount());
    host!.remove();
    vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: [] });
    const control = await mount();
    expect(control.querySelector('[role="status"]:not(.ui-shortfall)')).not.toBeNull();
  });
});
