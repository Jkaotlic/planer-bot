// @vitest-environment jsdom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Employee, type RosterImportPreview, type TemplateRolesView } from "../../api/client";
import { AdminKindSettings } from "./AdminKindSettings";
import { AdminRosterCsv } from "./AdminRosterCsv";
import { AdminShiftKinds } from "./AdminShiftKinds";

/**
 * Вложенные экраны расписания собраны из деталей `ui/`: «назад» — тихая кнопка
 * сверху, галочки — `CheckRow`, список — `SelectField`, шапка раскрывающейся
 * карточки — кнопка с `aria-expanded`. Поведение этих экранов держат соседние
 * тесты; здесь — только то, что они не видят: из чего экран собран.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/csv-encoding", () => ({
  readCsvFile: vi.fn(async () => ({ text: "csv-text", encoding: "utf-8" })),
}));

const person = (id: number, displayName: string): Employee => ({
  id, displayName, isAdmin: false, isActive: true, telegramUserId: 10 + id,
  birthDate: null, preferredName: null, address: displayName.split(" ")[0]!,
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
});
const EMPLOYEES = [person(1, "Аня Смирнова"), person(2, "Игорь Петров")];

const NIGHT: TemplateRolesView = {
  templateId: 7, name: "Ночь", category: "shift", accent: "blue", checklistIds: [], sendReminder: false, reminderText: null,
  coverage: [0, 0, 0, 0, 0, 0, 0], pool: [2], preference: {},
};

const PREVIEW: RosterImportPreview = {
  from: "2026-09-01", to: "2026-09-30", entryCount: 1,
  people: [{ csvName: "Аня Смирнова", suggestedEmployeeId: 1 }],
  unknowns: [], unknownsMessage: null, preservedCount: 0, existingCount: 3,
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
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
    });
  }
}

async function mount(node: ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => root!.render(createElement(AppRoot, null, node)));
  await settle();
  return host;
}

function click(node: Element) {
  return act(async () => (node as HTMLElement).click());
}

function mockKinds() {
  vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([NIGHT]);
  vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
  vi.spyOn(apiClient, "getTemplateQueue").mockResolvedValue({ rotationUnit: "day", queue: [] } as never);
}

describe("«Виды смен»", () => {
  it("«назад» — тихая кнопка первой в экране, зовёт onClose", async () => {
    mockKinds();
    const onClose = vi.fn();
    const el = await mount(createElement(AdminKindSettings, { onClose }));
    const back = el.querySelector("button") as HTMLButtonElement;
    expect(back.textContent).toBe("← Назад к расписанию");
    expect(back.className).toContain("ui-btn--quiet");
    await click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("«назад» есть и когда загрузка упала: иначе экран — тупик", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockRejectedValue(new Error("сеть"));
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([]);
    const el = await mount(createElement(AdminKindSettings, { onClose: () => {} }));
    expect(el.textContent).toContain("← Назад к расписанию");
    expect(el.textContent).toContain("Повторить");
  });

  it("раскрытая карточка: подписанный селект очереди и галочка напоминания на ui-деталях", async () => {
    mockKinds();
    const el = await mount(createElement(AdminKindSettings, { onClose: () => {} }));
    const head = el.querySelector("button[aria-expanded]") as HTMLButtonElement;
    expect(head.getAttribute("aria-expanded")).toBe("false");
    await click(head);
    await settle();
    expect(head.getAttribute("aria-expanded")).toBe("true");
    const select = el.querySelector(".ui-select--stretched select") as HTMLSelectElement;
    const label = el.querySelector("label.ui-field__label") as HTMLLabelElement;
    expect(label.textContent).toBe("Очередь идёт");
    expect(label.htmlFor).toBe(select.id);
    expect(el.querySelector(".ui-check input[type='checkbox']")).not.toBeNull();
  });

  it("чек-листы — кнопки с aria-pressed, а не самодельные фишки", async () => {
    vi.spyOn(apiClient, "getTemplateRoles").mockResolvedValue([{ ...NIGHT, checklistIds: [5] }]);
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([
      { id: 5, name: "Инструкция" }, { id: 6, name: "Закрытие" },
    ] as never);
    vi.spyOn(apiClient, "getTemplateQueue").mockResolvedValue({ rotationUnit: "day", queue: [] } as never);
    const el = await mount(createElement(AdminKindSettings, { onClose: () => {} }));
    await click(el.querySelector("button[aria-expanded]")!);
    await settle();
    const chips = [...el.querySelectorAll("button.ui-btn[aria-pressed]")] as HTMLButtonElement[];
    expect(chips.map((b) => [b.textContent, b.getAttribute("aria-pressed")])).toEqual([
      ["Инструкция", "true"], ["Закрытие", "false"],
    ]);
  });
});

describe("«Кто что может»", () => {
  it("«назад» — тихая кнопка сверху; у каждой строки вида две ui-галочки с понятным именем", async () => {
    mockKinds();
    const onClose = vi.fn();
    const el = await mount(createElement(AdminShiftKinds, { employees: EMPLOYEES, onClose }));
    const back = el.querySelector("button") as HTMLButtonElement;
    expect(back.className).toContain("ui-btn--quiet");
    await click(back);
    expect(onClose).toHaveBeenCalledTimes(1);

    const head = [...el.querySelectorAll("button[aria-expanded]")].find((b) => b.textContent?.includes("Игорь"))!;
    await click(head);
    const boxes = [...el.querySelectorAll(".ui-check input[type='checkbox']")] as HTMLInputElement[];
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Игорь Петров: допущен к «Ночь»",
      "Игорь Петров: любит «Ночь»",
    ]);
  });
});

describe("«График файлом»", () => {
  function props(over: Partial<Parameters<typeof AdminRosterCsv>[0]> = {}) {
    return { employees: EMPLOYEES, today: "2026-09-01", onError: () => {}, onNotice: () => {}, onImported: () => {}, onClose: () => {}, ...over };
  }

  it("«назад» — тихая кнопка сверху, зовёт onClose", async () => {
    const onClose = vi.fn();
    const el = await mount(createElement(AdminRosterCsv, props({ onClose })));
    const back = el.querySelector("button") as HTMLButtonElement;
    expect(back.textContent).toBe("← Назад к расписанию");
    expect(back.className).toContain("ui-btn--quiet");
    await click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("шаг проверки: «перезаписать» — ui-галочка, выбор сотрудника — растянутый ui-селект, primary одна", async () => {
    vi.spyOn(apiClient, "previewRosterImport").mockResolvedValue(PREVIEW);
    const el = await mount(createElement(AdminRosterCsv, props()));
    const input = el.querySelector("input[type='file']") as HTMLInputElement;
    const file = new File(["csv-text"], "roster.csv", { type: "text/csv" });
    const list = { 0: file, length: 1, item: (i: number) => (i === 0 ? file : null) } as unknown as FileList;
    await act(async () => {
      Object.defineProperty(input, "files", { value: list, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await settle();
    expect(el.querySelector(".ui-check input[type='checkbox']")).not.toBeNull();
    const select = el.querySelector(".ui-select--stretched select") as HTMLSelectElement;
    expect(select.getAttribute("aria-label")).toBe("Аня Смирнова");
    expect(el.querySelectorAll("button.ui-btn--primary")).toHaveLength(1);
  });
});
