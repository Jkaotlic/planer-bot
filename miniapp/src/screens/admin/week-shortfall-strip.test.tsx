// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type TemplateRolesView } from "../../api/client";
import { AdminScheduleScreen } from "./AdminScheduleScreen";

/**
 * Нехватка недели на полоске дней админского графика.
 *
 * Подсказка «Не хватает: Утро — 1» стоит только у выбранного дня, и чтобы
 * увидеть неделю, приходилось протыкать семь дней. Метка на самом дне отвечает
 * сразу за все семь, и отдельной сводки над полоской не нужно.
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

async function mount(roles: TemplateRolesView[], ackedDates: string[] = []) {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue(roles);
  vi.spyOn(apiClient, "getCoverageAcks").mockResolvedValue({ dates: ackedDates });
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
  });
  await settle();
  return host;
}

const chips = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("[data-day-chip]")];
const marks = (el: HTMLElement) => chips(el).map((chip) => chip.querySelector("[data-day-short]")?.textContent ?? null);

describe("нехватка на полоске дней недели", () => {
  it("метка стоит на каждом дне с дырой, а не только на выбранном", async () => {
    const el = await mount([kind(10, [2, 0, 1, 0, 3, 0, 0])]);
    expect(marks(el)).toEqual(["2", null, "1", null, "3", null, null]);
  });

  it("складывает виды одного дня в одно число", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0]), kind(20, [1, 0, 0, 0, 0, 0, 0])]);
    expect(marks(el)[0]).toBe("3");
  });

  it("день с отметкой «Знаю про дату» без метки, а закрытая отметками неделя — «Нормы закрыты»", async () => {
    // Понедельник 24-го и среда 26-го — дыры; админы сказали «знаем» про обе.
    const partly = await mount([kind(10, [2, 0, 1, 0, 0, 0, 0])], ["2026-08-24"]);
    expect(marks(partly)).toEqual([null, null, "1", null, null, null, null]);
    expect(chips(partly)[0]!.getAttribute("aria-label") ?? "").not.toContain("не хватает");
    await act(async () => root!.unmount());
    host!.remove();

    const all = await mount([kind(10, [2, 0, 1, 0, 0, 0, 0])], ["2026-08-24", "2026-08-26"]);
    expect(marks(all)).toEqual([null, null, null, null, null, null, null]);
    expect(all.querySelector("[data-shortfall]")?.getAttribute("data-shortfall")).toBe("closed");
  });

  it("подсказка выбранного дня («Не хватает: …») молчит у отмеченной даты", async () => {
    // Выбран сегодняшний день — среда 26-го, у неё дыра в 1.
    const open = await mount([kind(10, [2, 0, 1, 0, 0, 0, 0])]);
    expect(open.textContent ?? "").toContain("Не хватает: ");
    await act(async () => root!.unmount());
    host!.remove();
    const acked = await mount([kind(10, [2, 0, 1, 0, 0, 0, 0])], ["2026-08-26"]);
    expect(acked.textContent ?? "").not.toContain("Не хватает: ");
  });

  it("не удалось прочитать отметки — считаем как без них, экран не ломается", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    vi.spyOn(apiClient, "getCoverageAcks").mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [], employees: [], calendar: [] });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
    });
    await settle();
    expect(marks(host)[0]).toBe("2");
  });

  it("метка говорит словами тому, кто её не видит", async () => {
    const el = await mount([kind(10, [2, 0, 0, 0, 0, 0, 0])]);
    expect(chips(el)[0]!.getAttribute("aria-label")).toContain("не хватает 2");
    expect(chips(el)[1]!.getAttribute("aria-label") ?? "").not.toContain("не хватает");
  });

  it("без видов меток на днях нет, а плашка честно говорит, что норм нет", async () => {
    const el = await mount([]);
    expect(marks(el)).toEqual([null, null, null, null, null, null, null]);
    expect(el.querySelector("[data-shortfall]")?.getAttribute("data-shortfall")).toBe("no-norms");
  });

  it("виды без нормы — ссылка в плашке над полоской, и она ведёт в «Виды смен»", async () => {
    const el = await mount([kind(10, [0, 0, 0, 0, 0, 0, 0]), kind(20, [0, 0, 0, 0, 0, 0, 0])]);
    const line = el.querySelector<HTMLButtonElement>("[data-norm-unset]")!;
    expect(line.textContent).toBe("задать →");
    // Кнопкой в одной строке с заголовком, а не серой строчкой под ним: так её не замечали.
    expect(line.classList.contains("ui-btn")).toBe(true);
    expect(line.classList.contains("ui-btn--compact")).toBe(true);
    expect(line.parentElement!.querySelector(".ui-shortfall-title")?.textContent).toBe("Нормы не заданы");
    const strip = chips(el)[0]!;
    expect(line.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await act(async () => line.click());
    await settle(4);
    // Экран сменился на редактор видов: полоска дней под ним не показывается.
    expect(chips(el)).toHaveLength(0);
    expect(el.textContent ?? "").toContain("Виды смен");
  });

  it("после возврата из «Видов смен» полоска считает по свежим нормам", async () => {
    // Нормы читались один раз при открытии экрана: строка вела в настройку, а
    // по возвращении продолжала говорить «без нормы».
    const el = await mount([kind(10, [0, 0, 0, 0, 0, 0, 0])]);
    await act(async () => el.querySelector<HTMLButtonElement>("[data-norm-unset]")!.click());
    await settle(4);
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind(10, [1, 0, 0, 0, 0, 0, 0])]);
    const back = [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => /Назад|Готово|Закрыть/.test(b.textContent ?? ""))!;
    await act(async () => back.click());
    await settle();
    expect(el.querySelector("[data-norm-unset]")).toBeNull();
    expect(marks(el)[0]).toBe("1");
  });

  const mondayEntry = (date: string) => ({
    id: 1, date, endDate: null, start: "08:00", end: "17:00", employeeId: 1, employeeName: "Аня",
    category: "shift", templateId: 10, title: "Вид 10", location: null, unrecognisedCode: null,
  });

  it("норма задана и закрыта записями — ни метки, ни строки", async () => {
    const el = await mount([kind(10, [1, 0, 0, 0, 0, 0, 0])]);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ shifts: [mondayEntry("2026-08-24")], employees: [], calendar: [] } as never);
    await act(async () => el.querySelector<HTMLElement>("[aria-label='Следующая неделя']")!.click());
    await settle();
    await act(async () => el.querySelector<HTMLElement>("[aria-label='Прошлая неделя']")!.click());
    await settle();
    expect(marks(el)).toEqual([null, null, null, null, null, null, null]);
    expect(el.querySelector("[data-norm-unset]")).toBeNull();
  });

  it("пока расписание не пришло, меток нет: пустой ответ ещё не «никто не вышел»", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([kind(10, [1, 1, 1, 1, 1, 1, 1])]);
    vi.spyOn(apiClient, "getTeamSchedule").mockReturnValue(new Promise(() => {}));
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen, { today: TODAY })));
    });
    await settle();
    expect(chips(host)).toHaveLength(7);
    expect(marks(host)).toEqual([null, null, null, null, null, null, null]);
  });

  it("при листании не считает новую неделю по записям прежней", async () => {
    // Записи прежней недели остаются в состоянии до ответа сервера. Посчитанные
    // против дат новой, они дали бы «никого нет» — и закрытая неделя на время
    // запроса открывалась бы красной.
    const el = await mount([kind(10, [1, 0, 0, 0, 0, 0, 0])]);
    expect(marks(el)[0]).toBe("1");
    vi.spyOn(apiClient, "getTeamSchedule").mockReturnValue(new Promise(() => {}));
    await act(async () => el.querySelector<HTMLElement>("[aria-label='Следующая неделя']")!.click());
    await settle();
    expect(marks(el)).toEqual([null, null, null, null, null, null, null]);
    expect(el.textContent ?? "").not.toContain("Не хватает");
  });
});
