// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api/client";
import { App } from "./App";
import { ChecklistScreen } from "./screens/ChecklistScreen";
import { JournalScreen } from "./screens/JournalScreen";
import { WeekendAdminScreen } from "./screens/WeekendAdminScreen";
import { ScheduleGrid } from "./components/ScheduleGrid";
import { TeamTodayContext, useTeamToday } from "./lib/team-today";
import { toISODate } from "./lib/week";

/**
 * Консоль считает «сегодня» по командной дате сервера (`teamToday` из `/api/me`),
 * а не по часам браузера (B24). Дата в будущем выбрана нарочно: ни у какого
 * настоящего часового пояса «сегодня» не бывает 2099-03-04, так что тест красен
 * при любом поясе машины, на которой его гонят.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEAM_TODAY = "2099-03-04"; // среда; неделя с понедельника 2099-03-02

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
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function mountWith(node: ReturnType<typeof createElement>, today: string | null) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(TeamTodayContext.Provider, { value: today }, node)); });
  await settle();
  return host;
}

function Probe() {
  return createElement("span", { "data-probe": "" }, useTeamToday());
}

describe("useTeamToday", () => {
  it("с провайдером — командная дата, без него — день браузера", async () => {
    const withCtx = await mountWith(createElement(Probe), TEAM_TODAY);
    expect(withCtx.querySelector("[data-probe]")!.textContent).toBe(TEAM_TODAY);
    await act(async () => root!.unmount());
    host!.remove();
    const without = await mountWith(createElement(Probe), null);
    expect(without.querySelector("[data-probe]")!.textContent).toBe(toISODate(new Date()));
  });
});

describe("экраны берут командную дату", () => {
  it("чек-лист запрашивает день команды", async () => {
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    const day = vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({ date: TEAM_TODAY, people: [] });
    await mountWith(createElement(ChecklistScreen, { templates: [] }), TEAM_TODAY);
    expect(day).toHaveBeenCalledWith(TEAM_TODAY);
  });

  it("«Журнал»: отчёт по сменам открывается на месяце команды", async () => {
    vi.spyOn(apiClient, "getJournal").mockResolvedValue({ events: [], total: 0 } as never);
    const counts = vi.spyOn(apiClient, "getShiftCounts").mockResolvedValue({ kinds: [], rows: [] } as never);
    await mountWith(createElement(JournalScreen), TEAM_TODAY);
    expect(counts).toHaveBeenCalledWith("2099-03-01", "2099-03-31");
  });

  it("«Работа в выходные»: период часов — месяц команды", async () => {
    const payroll = vi.spyOn(apiClient, "getPayroll").mockResolvedValue([]);
    const el = await mountWith(createElement(WeekendAdminScreen), TEAM_TODAY);
    const show = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Показать"));
    await act(async () => show?.click());
    await settle();
    expect(payroll).toHaveBeenCalledWith("2099-03-01", "2099-03-31");
  });

  it("сетка подсвечивает сегодняшний день команды", async () => {
    const week = Array.from({ length: 7 }, (_, i) => `2099-03-0${2 + i}`.replace("2099-03-010", "2099-03-10"));
    const el = await mountWith(
      createElement(ScheduleGrid, { employees: [], shifts: [], templates: [], weekDates: week, calendar: new Map(), onAddClick: () => {}, onEntryClick: () => {}, query: "" }),
      TEAM_TODAY,
    );
    const heads = [...el.querySelectorAll(".schedule-table thead th")];
    const todayHead = heads.filter((th) => /today/.test(th.className));
    expect(todayHead).toHaveLength(1);
    expect(todayHead[0]).toBe(heads[3]); // колонка 0 — имена, 1 = пн 2-го, 3 = ср 4-го
  });
});

describe("App", () => {
  it("открывает неделю команды, а не неделю часов браузера", async () => {
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ id: 1, displayName: "Админов Админ", address: "Админ", teamToday: TEAM_TODAY, teamTz: "Europe/Moscow" });
    const schedule = vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(App)); });
    await settle(24);
    expect(schedule).toHaveBeenCalledWith("2099-03-02", "2099-03-08");
  });

  it("раздаёт командную дату экранам: чек-лист из меню просит день команды", async () => {
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ id: 1, displayName: "Админов Админ", address: "Админ", teamToday: TEAM_TODAY });
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    const day = vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue({ date: TEAM_TODAY, people: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(App)); });
    await settle(24);
    const item = [...host.querySelectorAll(".sidebar-nav-item")].find((n) => (n.textContent ?? "").includes("Чек-лист"));
    await act(async () => (item as HTMLElement).click());
    await settle();
    expect(day).toHaveBeenCalledWith(TEAM_TODAY);
  });

  it("раздаёт пояс команды: метка «заблокировал бота» в «Работниках» считается по нему", async () => {
    vi.spyOn(apiClient, "getMe").mockResolvedValue({ id: 1, displayName: "Админов Админ", address: "Админ", teamToday: TEAM_TODAY, teamTz: "Pacific/Honolulu" });
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue([]);
    const base = await apiClient.getEmployees();
    vi.spyOn(apiClient, "getEmployees").mockResolvedValue([{ ...base[0]!, telegramUserId: 77, botBlockedAt: "2026-09-11T22:30:00.000Z" }]);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => { root!.render(createElement(App)); });
    await settle(24);
    const item = [...host.querySelectorAll(".sidebar-nav-item")].find((n) => (n.textContent ?? "").includes("Работники"));
    await act(async () => (item as HTMLElement).click());
    await settle();
    expect(host.textContent ?? "").toContain("заблокировал бота с 11.09");
  });
});
