// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { CHECKLIST_RULE_TEXT } from "@planer/shared";
import { apiClient, type Checklist, type ChecklistDay, type Template } from "../../api/client";
import { AdminChecklists } from "./AdminChecklists";

/**
 * Экран отвечает на два вопроса админа, на которые раньше не отвечал нигде:
 * «я это поставил или нет» и «придёт ли дежурному сообщение — и всегда ли».
 *
 * Ответы считаются теми же правилами, что и рассылка (`@planer/shared`): экран,
 * считающий по-своему, хуже молчащего — по нему принимают решение.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const template = (over: Partial<Template>): Template => ({
  id: 1, name: "Утро", accent: "gold", start: "08:00", end: "17:00",
  fridayStart: null, fridayEnd: null, isLate: false, sendReminder: true,
  category: "shift", location: null, sortOrder: 1, ...over,
});

const TEMPLATES: Template[] = [
  template({ id: 6, name: "Дежурство с 07:00", start: "07:00", category: "duty", sortOrder: 1 }),
  template({ id: 1, name: "Утро", start: "08:00", sortOrder: 2 }),
];

const checklist = (over: Partial<Checklist>): Checklist => ({
  id: 5, name: "Обход 47-го", note: null, docUrl: null, docName: null, hasDoc: false,
  items: [{ id: 1, title: "Свет", note: null }], templateIds: [6], ...over,
});

const person = (over: Partial<ChecklistDay["people"][number]>): ChecklistDay["people"][number] => ({
  employeeId: 3, displayName: "Марк", checklistId: 5, checklistName: "Обход 47-го",
  done: 0, total: 1, start: "07:00", delivery: "scheduled", ...over,
});

const EMPTY_DAY: ChecklistDay = { date: "2026-08-24", people: [] };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let state: Checklist[] = [];

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 10) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
  }
}

async function mount(list: Checklist, day: ChecklistDay | Error = EMPTY_DAY) {
  state = [list];
  vi.spyOn(apiClient, "getChecklists").mockImplementation(async () => state);
  vi.spyOn(apiClient, "getTemplates").mockResolvedValue(TEMPLATES);
  vi.spyOn(apiClient, "getChecklistDay").mockImplementation(async () => {
    if (day instanceof Error) throw day;
    return day;
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(AppRoot, null, createElement(AdminChecklists))); });
  await settle();
  return host;
}

async function openCard(el: HTMLElement) {
  const head = el.querySelector("button[aria-expanded]") as HTMLButtonElement;
  await act(async () => head.click());
  await settle();
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

describe("«Чек-листы» в мини-аппе: уходит или нет", () => {
  it("шапка карточки говорит, что список уходит и кому", async () => {
    const el = await mount(checklist({}));
    expect(el.textContent).toContain("Уходит: Дежурство с 07:00");
  });

  it("заполненный, но никому не назначенный назван неуходящим", async () => {
    const el = await mount(checklist({ templateIds: [] }));
    expect(el.textContent).toContain("Не уходит: не выбран вид смены");
  });

  it("пустой список назван неуходящим — и всё равно называет, кому назначен", async () => {
    const el = await mount(checklist({ items: [] }));
    expect(el.textContent).toContain("Не уходит: ни пунктов, ни пояснения, ни файла");
    expect(el.textContent).toContain("Назначен: Дежурство с 07:00");
  });

  // Пунктов нет, а пояснение есть — бот такое шлёт с 2026-08-26.
  it("список с одним пояснением показан уходящим", async () => {
    const el = await mount(checklist({ items: [], note: "Обход от лифтов" }));
    expect(el.textContent).toContain("Уходит: Дежурство с 07:00");
  });

  it("внутри карточки написано правило: кому и когда уходит", async () => {
    const el = await mount(checklist({}));
    await openCard(el);
    expect(el.textContent).toContain(CHECKLIST_RULE_TEXT);
  });
});

describe("«Чек-листы» в мини-аппе: кому уйдёт сегодня", () => {
  it("называет время отправки и её исход по каждому", async () => {
    const el = await mount(checklist({}), {
      date: "2026-08-24",
      people: [
        person({ employeeId: 3, displayName: "Марк", start: "07:00", delivery: "sent", done: 1 }),
        person({ employeeId: 4, displayName: "Аня", start: "08:00", delivery: "scheduled" }),
        person({ employeeId: 5, displayName: "Игорь", delivery: "muted" }),
      ],
    });
    await openCard(el);
    expect(el.textContent).toContain("уже отправлено");
    expect(el.textContent).toContain("уйдёт в 08:00");
    expect(el.textContent).toContain("не уйдёт: напоминания выключены");
  });

  // У человека в день бывает два чек-листа; чужие строки в карточке отвечали бы
  // не на тот вопрос, который здесь задают.
  it("показывает только тех, кто проходит ЭТОТ список", async () => {
    const el = await mount(checklist({}), {
      date: "2026-08-24",
      people: [
        person({ employeeId: 3, displayName: "Марк" }),
        person({ employeeId: 4, displayName: "Аня", checklistId: 99, checklistName: "Чужой" }),
      ],
    });
    await openCard(el);
    expect(el.textContent).toContain("Марк");
    expect(el.textContent).not.toContain("Аня");
  });

  it("сегодня список никому не положен — так и сказано", async () => {
    const el = await mount(checklist({}));
    await openCard(el);
    expect(el.textContent).toContain("Сегодня этот чек-лист никому не положен");
  });

  // Сводка — не главное на экране: её отказ не должен выглядеть поломкой
  // настройки, ради которой сюда пришли.
  it("недоступная сводка не роняет экран", async () => {
    const el = await mount(checklist({}), new Error("нет сети"));
    await openCard(el);
    expect(el.textContent).toContain("Уходит: Дежурство с 07:00");
  });
});

describe("«Чек-листы» в мини-аппе: что сохранено", () => {
  it("говорит, что правка ещё не сохранена, и подтверждает сохранение", async () => {
    const el = await mount(checklist({}));
    await openCard(el);
    expect(el.textContent).not.toContain("Не сохранено");

    const saved = checklist({ note: "Обходим по часовой" });
    vi.spyOn(apiClient, "patchChecklist").mockImplementation(async () => {
      state = [saved];
      return saved;
    });
    const note = el.querySelector("textarea") as HTMLTextAreaElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Обходим по часовой");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(el.textContent).toContain("Не сохранено");

    await act(async () => buttonByText(el, "Сохранить инструкцию").click());
    await settle();
    expect(el.textContent).toContain("Сохранено");
    expect(el.textContent).not.toContain("Не сохранено");
  });

  // Виды смен, пункты и файл уходят на сервер по тапу, а пояснение — кнопкой.
  // Разница ничем не показывалась.
  it("говорит, что виды смен и пункты сохраняются сразу", async () => {
    const el = await mount(checklist({}));
    await openCard(el);
    expect(el.textContent).toContain("сохраняются сразу");
  });
});
