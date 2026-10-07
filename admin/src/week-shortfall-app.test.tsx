// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient, type TemplateRolesView } from "./api/client";
import { App } from "./App";
import { addDays, mondayOf, toISODate } from "./lib/week";

/**
 * Строка нехватки в «Расписании» консоли — проводка от норм до экрана.
 *
 * Сама строка проверена в `week-shortfall-bar.test.tsx`. Здесь — то, что видно
 * только на собранном экране: она стоит НАД сеткой (под сеткой её пришлось бы
 * искать прокруткой), клик по дню доходит до колонки, а хвост «без нормы»
 * действительно уводит в «Виды смен».
 */

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

async function settle(times = 20) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

const role = (templateId: number, name: string, coverage: number[]): TemplateRolesView => ({
  templateId, name, category: "shift", accent: "gold", pool: [], preference: {}, checklistIds: [],
  sendReminder: false, reminderText: null, coverage,
});

async function mount(roles: TemplateRolesView[]) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(roles);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

// Норма, которую мок-график заведомо не закрывает ни в один день.
const HUGE = role(9001, "Невозможная", [99, 99, 99, 99, 99, 99, 99]);

describe("строка нехватки в «Расписании»", () => {
  it("стоит над сеткой недели", async () => {
    const el = await mount([HUGE]);
    const bar = el.querySelector(".week-shortfall")!;
    const table = el.querySelector(".schedule-table")!;
    expect(bar.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(el.querySelectorAll(".day-short-badge")).toHaveLength(7);
  });

  it("клик по дню выделяет его колонку в сетке", async () => {
    const el = await mount([HUGE]);
    expect(el.querySelector("th.pointed-col")).toBeNull();
    const days = el.querySelectorAll<HTMLButtonElement>(".week-shortfall-day");
    await act(async () => days[2]!.click());
    const headers = [...el.querySelectorAll(".schedule-table thead th")];
    expect(headers.findIndex((th) => th.classList.contains("pointed-col"))).toBe(3);
  });

  it("выделение не переезжает на другую неделю", async () => {
    const el = await mount([HUGE]);
    await act(async () => el.querySelectorAll<HTMLButtonElement>(".week-shortfall-day")[2]!.click());
    await act(async () => (el.querySelector("[aria-label='Следующая неделя']") as HTMLElement).click());
    await settle(6);
    expect(el.querySelector(".pointed-col")).toBeNull();
    expect(el.querySelector(".week-shortfall-day[aria-pressed='true']")).toBeNull();
  });

  it("шапка колонки дня с дырой — красная целиком", async () => {
    const el = await mount([HUGE]);
    expect(el.querySelectorAll(".schedule-table thead th.short-col").length).toBe(7);
  });

  describe("«Знаю про дату» закрывает день и в консоли", () => {
    const week = () => Array.from({ length: 7 }, (_, i) => toISODate(addDays(mondayOf(new Date()), i)));

    it("все дни недели отмечены: «Нормы закрыты», колонки не красные, меток нет", async () => {
      vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: week() });
      const el = await mount([HUGE]);
      expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("closed");
      expect(el.querySelectorAll(".schedule-table thead th.short-col")).toHaveLength(0);
      expect(el.querySelectorAll(".day-short-badge")).toHaveLength(0);
      expect(el.querySelectorAll(".week-shortfall-day")).toHaveLength(0);
    });

    it("отмечен один день из семи: его колонка не красная, остальные шесть красные", async () => {
      vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: [week()[2]!] });
      const el = await mount([HUGE]);
      expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("short");
      expect(el.querySelectorAll(".schedule-table thead th.short-col")).toHaveLength(6);
      const headers = [...el.querySelectorAll(".schedule-table thead th")];
      expect(headers[3]!.classList.contains("short-col")).toBe(false);
    });
  });

  // Среда текущей недели — праздник, норма стоит именно на среду, воскресная нулевая.
  // Календарь, подмененный на пустой (в плашке или в сетке), снова требовал бы людей по среде.
  describe("праздник и норма на тот же день недели", () => {
    const WEDNESDAY = toISODate(addDays(mondayOf(new Date()), 2));
    const wednesdayNorm = role(9004, "Среда", [0, 0, 2, 0, 0, 0, 0]);

    it("праздник считается по воскресенью: плашка закрыта, колонка не красная", async () => {
      vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);
      vi.spyOn(apiClient, "getDayCalendar").mockResolvedValue([{ date: WEDNESDAY, kind: "holiday", note: "День теста", source: "manual" }]);
      const el = await mount([wednesdayNorm]);
      expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("closed");
      expect(el.querySelectorAll("th.short-col")).toHaveLength(0);
      expect(el.querySelectorAll(".day-short-badge")).toHaveLength(0);
    });

    it("контроль: без праздника та же норма — нехватка, красная колонка среды", async () => {
      vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);
      vi.spyOn(apiClient, "getDayCalendar").mockResolvedValue([]);
      const el = await mount([wednesdayNorm]);
      expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("short");
      const headers = [...el.querySelectorAll(".schedule-table thead th")];
      expect(headers.findIndex((th) => th.classList.contains("short-col"))).toBe(3);
      expect(el.querySelectorAll(".day-short-badge")).toHaveLength(1);
    });
  });

  describe("«Ближайшая нехватка»: метка считает сегодня…+6 и пересекает границу недели", () => {
    const nextMonday = toISODate(addDays(mondayOf(new Date()), 7));
    const closedWeek = () => {
      const week = Array.from({ length: 7 }, (_, i) => toISODate(addDays(mondayOf(new Date()), i)));
      vi.spyOn(apiClient, "getTeamSchedule").mockImplementation(async (from: string) =>
        from === week[0]
          ? week.map((date, i) => ({
              id: 100 + i, date, endDate: null, start: "08:00", end: "17:00", employeeId: 1,
              category: "shift", templateId: 9005, title: "Закрытая", location: null, unrecognisedCode: null,
            }))
          : []);
      vi.spyOn(apiClient, "getAdminShortfall").mockResolvedValue({ total: 3, firstDate: nextMonday });
      return mount([role(9005, "Закрытая", [1, 1, 1, 1, 1, 1, 1])]);
    };

    it("закрытая неделя, а нехватка в следующей — строка видна и ведёт туда: неделя и колонка дня", async () => {
      const el = await closedWeek();
      expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("closed");
      const line = el.querySelector<HTMLButtonElement>(".week-shortfall-nearest")!;
      expect(line.textContent).toContain("Ближайшая нехватка: Пн");
      const getSchedule = vi.mocked(apiClient.getTeamSchedule);
      getSchedule.mockClear();
      await act(async () => line.click());
      // Дольше прежнего: до ответа новой недели сетки нет вовсе (спиннер), колонка
      // появляется вместе с ней.
      await settle(20);
      expect(getSchedule).toHaveBeenCalledWith(nextMonday, toISODate(addDays(mondayOf(new Date()), 13)));
      // Колонка понедельника новой недели указана, строка больше не нужна.
      const headers = [...el.querySelectorAll(".schedule-table thead th")];
      expect(headers.findIndex((th) => th.classList.contains("pointed-col"))).toBe(1);
      expect(el.querySelector(".week-shortfall-nearest")).toBeNull();
    });
  });

  it("пока неделя грузится, плашки нет", async () => {
    vi.spyOn(apiClient, "getTeamSchedule").mockReturnValue(new Promise(() => {}));
    const el = await mount([HUGE]);
    expect(el.querySelector(".week-shortfall")).toBeNull();
  });

  it("норма задана и закрыта записями — зелёная плашка, ни меток, ни красных шапок", async () => {
    const week = Array.from({ length: 7 }, (_, i) => toISODate(addDays(mondayOf(new Date()), i)));
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue(week.map((date, i) => ({
      id: 100 + i, date, endDate: null, start: "08:00", end: "17:00", employeeId: 1,
      category: "shift", templateId: 9003, title: "Закрытая", location: null, unrecognisedCode: null,
    })));
    const el = await mount([role(9003, "Закрытая", [1, 1, 1, 1, 1, 1, 1])]);
    expect(el.querySelector(".schedule-table")).not.toBeNull();
    expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("closed");
    expect(el.querySelectorAll(".day-short-badge")).toHaveLength(0);
    expect(el.querySelectorAll("th.short-col")).toHaveLength(0);
  });

  it("при листании не считает новую неделю по записям прежней", async () => {
    const el = await mount([HUGE]);
    vi.spyOn(apiClient, "getTeamSchedule").mockReturnValue(new Promise(() => {}));
    await act(async () => (el.querySelector("[aria-label='Следующая неделя']") as HTMLElement).click());
    await settle(6);
    expect(el.querySelector(".week-shortfall")).toBeNull();
    expect(el.querySelectorAll(".day-short-badge")).toHaveLength(0);
  });

  it("видов смен нет вовсе — нейтральная плашка «Нормы не заданы»", async () => {
    const el = await mount([]);
    expect(el.querySelector(".schedule-table")).not.toBeNull();
    expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("no-norms");
    const set = [...el.querySelectorAll<HTMLButtonElement>(".week-shortfall button")].find((b) => b.textContent === "задать →")!;
    expect(set).toBeDefined();
    await act(async () => set.click());
    await settle(4);
    expect(el.querySelector(".kinds-intro")).not.toBeNull();
  });

  it("хвост «без нормы» открывает «Виды смен»", async () => {
    const el = await mount([role(9002, "Без нормы", [0, 0, 0, 0, 0, 0, 0])]);
    await act(async () => el.querySelector<HTMLButtonElement>(".week-shortfall-unset")!.click());
    await settle(4);
    expect(el.querySelector(".schedule-table")).toBeNull();
    expect(el.querySelector(".kinds-intro")).not.toBeNull();
  });

  it("после возврата из «Видов смен» строка считает по свежим нормам", async () => {
    // Нормы читались один раз при загрузке консоли: хвост вёл в настройку, а
    // по возвращении продолжал говорить «без нормы» про вид, которому её задали.
    const el = await mount([role(9002, "Без нормы", [0, 0, 0, 0, 0, 0, 0])]);
    await act(async () => el.querySelector<HTMLButtonElement>(".week-shortfall-unset")!.click());
    await settle(4);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([HUGE]);
    const back = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => (b.textContent ?? "").trim() === "Расписание")!;
    await act(async () => back.click());
    await settle();
    expect(el.querySelector(".week-shortfall-unset")).toBeNull();
    expect(el.querySelector(".week-shortfall-total")).not.toBeNull();
  });
});
