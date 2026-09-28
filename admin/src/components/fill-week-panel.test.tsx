// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calendarFrom } from "@planer/shared";
import { apiClient, type Employee, type Template } from "../api/client";
import { FillWeekPanel } from "./FillWeekPanel";

/**
 * «Заполнить неделю» в консоли — перенос из мини-аппа.
 *
 * Главное здесь не форма, а то, что уходит на сервер: ОДИН запрос на всю
 * неделю (семь `POST` подряд — семь писем человеку за одно нажатие), дни
 * пресета — со временем пятницы, где пятница, а «все будни одним вариантом»
 * не трогают Сб, Вс и праздники: молча поставить человека на выходной хуже,
 * чем попросить сделать это руками.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Неделя с понедельника 2026-06-08; пятница 12-го — День России.
const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

const person = (id: number, displayName: string, over: Partial<Employee> = {}): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ").at(-1)!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true, ...over,
});

const DAY: Template = {
  sortOrder: 1, id: 2, name: "День", accent: "blue", start: "09:00", end: "18:00",
  fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false, category: "shift", location: null,
};

const PEOPLE = [person(1, "Иванова Анна"), person(2, "Смирнов Игорь", { excludedFromAssignment: true })];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 4) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function mount(onFilled = vi.fn(async () => {}), holidays = true) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const calendar = calendarFrom(holidays ? [{ date: "2026-06-12", kind: "holiday" }] : []);
  await act(async () => {
    root!.render(createElement(FillWeekPanel, {
      employees: PEOPLE, templates: [DAY], weekDates: WEEK, calendar, onCancel: () => {}, onFilled,
    }));
  });
  return { el: host, onFilled };
}

function buttonWith(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

function selectFor(el: HTMLElement, label: string): HTMLSelectElement {
  const select = el.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (!select) throw new Error(`нет выбора «${label}»`);
  return select;
}

async function choose(select: HTMLSelectElement, value: string) {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("FillWeekPanel (консоль)", () => {
  it("вся неделя — одним запросом, пятница со своим временем", async () => {
    const create = vi.spyOn(apiClient, "createEntries").mockResolvedValue({ created: 2, notified: { delivered: 1, intended: 1 } });
    const { el, onFilled } = await mount();

    await act(async () => buttonWith(el, "Иванова Анна").click());
    await choose(selectFor(el, "Пн, 8 июня"), "p:2");
    await choose(selectFor(el, "Пт, 12 июня"), "p:2");
    await act(async () => buttonWith(el, "Заполнить (2)").click());
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith([
      { date: "2026-06-08", category: "shift", employeeId: 1, templateId: 2, start: "09:00", end: "18:00", title: "День" },
      { date: "2026-06-12", category: "shift", employeeId: 1, templateId: 2, start: "09:00", end: "16:45", title: "День" },
    ]);
    expect(onFilled).toHaveBeenCalledWith(2, { delivered: 1, intended: 1 });
  });

  it("«все будни» не трогают выходные и праздники", async () => {
    const create = vi.spyOn(apiClient, "createEntries").mockResolvedValue({ created: 4, notified: { delivered: 1, intended: 1 } });
    const { el } = await mount();

    await act(async () => buttonWith(el, "Иванова Анна").click());
    await choose(selectFor(el, "Все будни одним вариантом"), "p:2");
    await act(async () => buttonWith(el, "Заполнить (4)").click());
    await settle();

    const dates = create.mock.calls[0]![0].map((input) => input.date);
    expect(dates).toEqual(["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11"]);
  });

  it("категория без пресета: отсутствие без времени, работа — с 09:00–18:00", async () => {
    const create = vi.spyOn(apiClient, "createEntries").mockResolvedValue({ created: 2, notified: { delivered: 0, intended: 0 } });
    const { el } = await mount();

    await act(async () => buttonWith(el, "Иванова Анна").click());
    await choose(selectFor(el, "Вт, 9 июня"), "c:vacation");
    await choose(selectFor(el, "Ср, 10 июня"), "c:duty");
    await act(async () => buttonWith(el, "Заполнить (2)").click());
    await settle();

    expect(create.mock.calls[0]![0]).toEqual([
      { date: "2026-06-09", category: "vacation", employeeId: 1 },
      { date: "2026-06-10", category: "duty", employeeId: 1, start: "09:00", end: "18:00" },
    ]);
  });

  it("без выбранных дней не шлёт ничего и говорит почему", async () => {
    const create = vi.spyOn(apiClient, "createEntries");
    const { el } = await mount();

    await act(async () => buttonWith(el, "Иванова Анна").click());
    await act(async () => buttonWith(el, "Заполнить").click());
    await settle();

    expect(create).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Выберите хотя бы один день");
  });

  it("отказ сервера остаётся в панели", async () => {
    vi.spyOn(apiClient, "createEntries").mockRejectedValue(new Error("Смирнов в отпуске 9 июня"));
    const { el, onFilled } = await mount();

    await act(async () => buttonWith(el, "Иванова Анна").click());
    await choose(selectFor(el, "Вт, 9 июня"), "p:2");
    await act(async () => buttonWith(el, "Заполнить (1)").click());
    await settle();

    expect(onFilled).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Смирнов в отпуске 9 июня");
  });

  it("того, кого бот сам не ставит, помечает — выбрать по инерции труднее", async () => {
    const { el } = await mount();
    expect(buttonWith(el, "Смирнов Игорь").textContent).toContain("вне назначений");
  });
});
