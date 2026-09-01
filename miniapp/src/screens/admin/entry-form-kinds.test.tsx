// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { AdminScheduleScreen } from "./AdminScheduleScreen";
import { apiClient, type Employee, type NewEntryRangeInput, type Shift, type Template } from "../../api/client";

/**
 * Зеркало `admin/src/components/add-entry-panel.test.tsx`.
 *
 * Два фронта показывают одну и ту же форму, и разъехаться им нельзя: правило
 * «смены и дежурства одним списком» живёт в `@planer/shared`, а вот то, что обе
 * формы его действительно зовут, стережёт пара тестов — по одному на фронт.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const template = (over: Partial<Template>): Template => ({
  id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00",
  fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true,
  category: "shift", location: null, sortOrder: 1, ...over,
});

const TEMPLATES: Template[] = [
  template({ id: 1, name: "Утро", category: "shift", sortOrder: 1 }),
  template({ id: 2, name: "Дежурство · Поклонка", category: "duty", sortOrder: 2, location: "Поклонка" }),
  template({ id: 3, name: "День", category: "shift", sortOrder: 3, start: "09:00", end: "18:00" }),
];

const EMPLOYEE: Employee = {
  id: 4, displayName: "Иванов Иван", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
}

async function openForm() {
  vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [{ ...EMPLOYEE, rosterOrder: 0 }], shifts: [] });
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen)));
  });
  await settle();

  const add = [...host.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("＋ Добавить"));
  if (!add) throw new Error("не нашёл кнопку «＋ Добавить»");
  await act(async () => add.click());
  await settle(2);
  return host;
}

/** Селект «Что ставим» — единственный, где есть вариант «Своё время». */
function kindSelect(el: HTMLElement): HTMLSelectElement {
  const found = [...el.querySelectorAll("select")].find((s) =>
    [...s.options].some((o) => o.textContent === "Своё время"),
  );
  if (!found) throw new Error("не нашёл список «Что ставим»");
  return found;
}

async function setValue(field: HTMLSelectElement | HTMLInputElement, value: string) {
  const proto = field instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype : window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("форма записи в мини-аппе — один список видов", () => {
  it("держит смены и дежурства в одном списке, без шага «Категория»", async () => {
    const el = await openForm();
    const options = [...kindSelect(el).options].map((o) => o.textContent);
    expect(options[0]).toContain("Утро");
    expect(options[1]).toContain("Дежурство · Поклонка");
    expect(options[2]).toContain("День");
    expect(options).toContain("Своё время");
    expect(options).toContain("Отпуск");

    // Отдельного списка «Категория» с семью пунктами больше нет.
    const hasCategorySelect = [...el.querySelectorAll("select")].some((s) => {
      const texts = [...s.options].map((o) => o.textContent);
      return texts.includes("Смена") && texts.includes("Отпуск") && texts.includes("Дежурство");
    });
    expect(hasCategorySelect).toBe(false);
  });

  it("диапазон уходит в свою ручку и не берёт выходные без спроса", async () => {
    let saved: NewEntryRangeInput | null = null;
    const range = vi.spyOn(apiClient, "createEntryRange").mockImplementation(async (input) => {
      saved = input;
      return { created: [], updated: [], skipped: [], notified: { delivered: 0, intended: 0 } };
    });
    const el = await openForm();

    const dates = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    expect(dates).toHaveLength(2);
    await setValue(dates[0]!, "2026-06-08"); // понедельник
    await setValue(dates[1]!, "2026-06-14"); // воскресенье

    expect(el.querySelector('[data-testid="range-preview"]')!.textContent)
      .toContain("5 дней · пропущено 2: 2 выходных");

    // Работник выбирается рядом списка, а не `<select>`: на телефоне тот
    // открывается системным колесом без поиска.
    const personRow = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Иванов Иван"));
    if (!personRow) throw new Error("не нашёл строку работника");
    await act(async () => personRow.click());
    await act(async () => {
      [...el.querySelectorAll("button")].find((b) => b.textContent === "Добавить")!.click();
    });
    await settle(2);

    expect(range).toHaveBeenCalled();
    expect(saved).toMatchObject({ from: "2026-06-08", to: "2026-06-14", includeWeekends: false, category: "shift" });
  });
});


/**
 * Правка отрезком — зеркало `admin/src/components/add-entry-panel.test.tsx`.
 *
 * Обе формы обязаны предлагать одно и то же: админ, открывший запись в мини-аппе,
 * и админ, открывший её в консоли, ждут одинакового поведения от одинаковой на
 * вид формы, и разъехаться здесь дороже всего.
 */
describe("форма записи в мини-аппе — правка отрезком", () => {
  const TODAY = new Date().toISOString().slice(0, 10);
  const TOMORROW = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

  const EXISTING: Shift = {
    id: 77, date: TODAY, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title: "Утро", location: null, unrecognisedCode: null, templateId: 1,
    employeeId: EMPLOYEE.id, employeeName: EMPLOYEE.displayName,
  };

  async function openEdit() {
    vi.spyOn(apiClient, "getAdminEmployees").mockResolvedValue([EMPLOYEE]);
    vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
    vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({
      employees: [{ ...EMPLOYEE, rosterOrder: 0 }], shifts: [EXISTING],
    });
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([]);

    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root!.render(createElement(AppRoot, null, createElement(AdminScheduleScreen)));
    });
    await settle();

    // Классы telegram-ui хешированы, поэтому строка ищется по тексту: самый
    // глубокий узел с именем работника, а клик по нему всплывёт до `onTap`.
    const named = [...host.querySelectorAll<HTMLElement>("*")]
      .filter((el) => (el.textContent ?? "").includes("Иванов Иван") && !(el.textContent ?? "").includes("Добавить"));
    const row = named.at(-1);
    if (!row) throw new Error("не нашёл запись в списке дня");
    await act(async () => row.click());
    await settle(2);
    return host;
  }

  it("предлагает «с» и «по», а не один день", async () => {
    const el = await openEdit();
    expect([...el.querySelectorAll<HTMLInputElement>('input[type="date"]')]).toHaveLength(2);
  });

  it("шлёт перезапись отрезка, а не расстановку", async () => {
    let saved: NewEntryRangeInput | null = null;
    vi.spyOn(apiClient, "createEntryRange").mockImplementation(async (input) => {
      saved = input;
      return { created: [], updated: [], skipped: [], notified: { delivered: 0, intended: 0 } };
    });
    const el = await openEdit();

    const dates = [...el.querySelectorAll<HTMLInputElement>('input[type="date"]')];
    await setValue(dates[1]!, TOMORROW);
    // Выходные включаются, чтобы тест не зависел от того, на какой день недели
    // он сегодня запустился.
    await act(async () => el.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await act(async () => {
      [...el.querySelectorAll("button")].find((b) => b.textContent === "Сохранить")!.click();
    });
    await settle(2);

    expect(saved).toMatchObject({ employeeId: EMPLOYEE.id, from: TODAY, to: TOMORROW, mode: "rewrite" });
  });

  it("предупреждает, что занятые дни перепишутся", async () => {
    const el = await openEdit();
    await setValue([...el.querySelectorAll<HTMLInputElement>('input[type="date"]')][1]!, TOMORROW);
    const text = el.querySelector('[data-testid="range-preview"]')!.textContent ?? "";
    expect(text).toContain("перепишутся");
    expect(text).not.toContain("пропустятся");
  });
});
