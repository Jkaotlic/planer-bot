// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type TemplateRolesView } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Плашка нехватки над графиком: стоит всегда и первой, иначе молчащая подсказка
 * неотличима от отсутствующей (владелец не знал, что она есть, 02.10.2026).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const kind = (templateId: number, coverage: number[]): TemplateRolesView => ({
  templateId, name: `Вид ${templateId}`, category: "shift", accent: "gold", checklistIds: [], sendReminder: false, reminderText: null,
  coverage, pool: [], preference: {},
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

// Среда: неделя 24–30 августа 2026, понедельник — первая клетка полоски.
const TODAY = "2026-08-26";

async function mountRaw() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const entry = (date: string) => ({
  id: 1, date, endDate: null, start: "08:00", end: "17:00", employeeId: 7, employeeName: "Аня",
  category: "shift", templateId: 10, title: "Вид 10", location: null, unrecognisedCode: null,
});

async function mount(roles: TemplateRolesView[], shifts: ReturnType<typeof entry>[] = []) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(roles);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts, employees: [], calendar: [] } as never);
  return mountRaw();
}

const banner = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-shortfall]");

describe("плашка нехватки над графиком мини-аппа", () => {
  it("дыра — красная плашка с числом и раскладом по дням", async () => {
    const el = await mount([kind(10, [2, 0, 1, 0, 0, 0, 0])]);
    expect(banner(el)?.dataset.shortfall).toBe("short");
    expect(banner(el)?.textContent).toContain("Не хватает 3");
    expect(banner(el)?.textContent).toContain("Пн");
    expect(banner(el)?.textContent).toContain("Вид 10 −2");
  });

  it("стоит раньше полоски дней — её видно, не листая", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    const chip = el.querySelector("[data-day-chip]")!;
    expect(banner(el)!.compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("стоит раньше и недельной шапки: первым блоком экрана", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    const prev = el.querySelector("[aria-label='Прошлая неделя']")!;
    expect(banner(el)!.compareDocumentPosition(prev) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("закрытая неделя — зелёная «Нормы закрыты»", async () => {
    const el = await mount([kind(10, [1, 0, 0, 0, 0, 0, 0])], [entry("2026-08-24")]);
    expect(banner(el)?.dataset.shortfall).toBe("closed");
    expect(banner(el)?.textContent).toContain("Нормы закрыты");
  });

  it("нормы не заданы ни у одного вида — нейтральная, не зелёная", async () => {
    const el = await mount([kind(10, [0, 0, 0, 0, 0, 0, 0])]);
    expect(banner(el)?.dataset.shortfall).toBe("no-norms");
    expect(banner(el)?.textContent).toContain("Нормы не заданы");
  });

  it("пока неделя грузится, плашки нет", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    vi.spyOn(apiClient, "getTeamSchedule").mockReturnValue(new Promise(() => {}));
    const el = await mountRaw();
    expect(banner(el)).toBeNull();
  });

  // Сегодня среда и она выбрана с самого начала: тап по среде прошёл бы и без
  // обработчика, поэтому проверяем перенос выбора на понедельник.
  it("тап по дню в плашке выбирает этот день", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    expect(el.querySelector("[data-day-chip][aria-pressed='true']")?.getAttribute("aria-label")).toContain("26");
    await act(async () => banner(el)!.querySelector<HTMLButtonElement>("[data-shortfall-day='2026-08-24']")!.click());
    expect(el.querySelector("[data-day-chip][aria-pressed='true']")?.getAttribute("aria-label")).toContain("24");
  });

  it("день с дырой обведён красным", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    const chips = [...el.querySelectorAll<HTMLElement>("[data-day-chip]")];
    expect(chips[0]!.dataset.dayShortOutline).toBe("true");
    expect(chips[1]!.dataset.dayShortOutline).toBeUndefined();
  });

  it("виды без нормы — строка в плашке, ведёт в «Виды смен»", async () => {
    const el = await mount([kind(10, [1, 0, 0, 0, 0, 0, 0]), kind(20, [0, 0, 0, 0, 0, 0, 0])], [entry("2026-08-24")]);
    const line = banner(el)!.querySelector<HTMLButtonElement>("[data-norm-unset]")!;
    expect(line.textContent).toBe("Без нормы: 1 вид — задать →");
    await act(async () => line.click());
    await settle(4);
    expect(el.querySelector("[data-day-chip]")).toBeNull();
    expect(el.textContent ?? "").toContain("Виды смен");
  });

  it("onScheduleChanged зовётся после отметки дня выходным", async () => {
    const onScheduleChanged = vi.fn();
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] } as never);
    vi.spyOn(apiClient, "setCalendarDay").mockResolvedValue(undefined as never);
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY, onScheduleChanged })));
    });
    await settle();
    expect(onScheduleChanged).not.toHaveBeenCalled();
    const mark = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => /выходн/i.test(b.textContent ?? ""));
    expect(mark).toBeTruthy();
    await act(async () => mark!.click());
    await settle();
    expect(onScheduleChanged).toHaveBeenCalledTimes(1);
  });
});
