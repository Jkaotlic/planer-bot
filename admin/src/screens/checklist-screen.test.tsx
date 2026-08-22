// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecklistScreen } from "./ChecklistScreen";
import { apiClient, type Checklist, type ChecklistDay, type Template } from "../api/client";

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

async function settle(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

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
  id: 1, name: "Дежурство с 07:00", note: null, docUrl: null, docName: null, hasDoc: false,
  items: [], templateIds: [], ...over,
});

const EMPTY_DAY: ChecklistDay = { date: "2026-08-24", people: [] };

async function mount(checklists: Checklist[], day: ChecklistDay = EMPTY_DAY) {
  vi.spyOn(apiClient, "getChecklists").mockResolvedValue(checklists);
  vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue(day);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ChecklistScreen, { templates: TEMPLATES })); });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

async function openCard(el: HTMLElement, name: string) {
  const head = [...el.querySelectorAll<HTMLButtonElement>(".kind-card-head")].find((b) => (b.textContent ?? "").includes(name));
  if (!head) throw new Error(`не нашёл карточку «${name}»`);
  await act(async () => head.click());
}

describe("экран «Чек-листы»", () => {
  /**
   * Пустой список — не поломка, а состояние по умолчанию: содержимое проверки
   * пишет команда. Экран обязан сказать это словами.
   */
  it("без единого чек-листа объясняет себя, а не молчит", async () => {
    const el = await mount([]);
    expect(el.textContent).toContain("Чек-листов пока нет");
  });

  /** Ровно то, ради чего сущность заведена: у «с 07:00» и «с 08:00» свои списки. */
  it("показывает несколько чек-листов и кому каждый назначен", async () => {
    const el = await mount([
      checklist({ id: 1, name: "С 07:00", templateIds: [6], items: [{ id: 1, title: "Открыть 47-й", note: null }] }),
      checklist({ id: 2, name: "С 08:00", templateIds: [1], items: [] }),
    ]);
    const heads = [...el.querySelectorAll(".kind-card-head")].map((h) => h.textContent ?? "");
    expect(heads[0]).toContain("С 07:00");
    expect(heads[0]).toContain("Дежурство с 07:00");
    expect(heads[1]).toContain("С 08:00");
    expect(heads[1]).toContain("Утро");
  });

  it("говорит, когда чек-лист никому не назначен", async () => {
    const el = await mount([checklist({ name: "Ничей" })]);
    expect(el.querySelector(".kind-card-head")!.textContent).toContain("никому не назначен");
  });

  it("заводит новый чек-лист по имени", async () => {
    const el = await mount([]);
    const create = vi.spyOn(apiClient, "createChecklist").mockResolvedValue(checklist({ id: 9, name: "С 08:00" }));
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Название чек-листа"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, "С 08:00");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText(el, "Новый чек-лист").click());
    await settle();
    expect(create).toHaveBeenCalledWith("С 08:00");
  });

  /** «Скоп смен» правится здесь: вопрос «кто это проходит» задают чек-листу. */
  it("привязывает вид смены к чек-листу прямо в его карточке", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", templateIds: [] })]);
    const link = vi.spyOn(apiClient, "setChecklistTemplates").mockResolvedValue(checklist({ templateIds: [6] }));
    await openCard(el, "С 07:00");
    const chip = [...el.querySelectorAll<HTMLButtonElement>(".category-option")].find((b) => (b.textContent ?? "").includes("Дежурство с 07:00"))!;
    await act(async () => chip.click());
    await settle();
    expect(link).toHaveBeenCalledWith(1, [6]);
  });

  it("снимает привязку повторным нажатием", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", templateIds: [6, 1] })]);
    const link = vi.spyOn(apiClient, "setChecklistTemplates").mockResolvedValue(checklist({ templateIds: [1] }));
    await openCard(el, "С 07:00");
    const chip = [...el.querySelectorAll<HTMLButtonElement>(".category-option")].find((b) => (b.textContent ?? "").includes("Дежурство с 07:00"))!;
    await act(async () => chip.click());
    await settle();
    expect(link).toHaveBeenCalledWith(1, [1]);
  });

  it("добавляет пункт в тот чек-лист, чья карточка открыта", async () => {
    const el = await mount([
      checklist({ id: 1, name: "С 07:00" }),
      checklist({ id: 2, name: "С 08:00" }),
    ]);
    const add = vi.spyOn(apiClient, "addChecklistItem").mockResolvedValue(checklist({ id: 2 }));
    await openCard(el, "С 08:00");
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Новый пункт в «С 08:00»"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, "Проверить переговорные");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText(el, "Добавить").click());
    await settle();
    expect(add).toHaveBeenCalledWith(2, "Проверить переговорные");
  });

  /**
   * Файл кладётся только через бота: браузер не умеет положить документ в
   * Telegram так, чтобы бот потом мог его переслать. Экран обязан назвать
   * единственный путь, а не молчать про него.
   */
  it("объясняет, что файл прикладывают через бота, и называет чек-лист", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    await openCard(el, "С 07:00");
    expect(el.textContent).toContain("/instruction");
    expect(el.textContent).toContain("выбери «С 07:00»");
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it("называет приложенный файл и даёт его убрать", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", hasDoc: true, docName: "Проверка 47.pdf" })]);
    const remove = vi.spyOn(apiClient, "removeChecklistDoc").mockResolvedValue(checklist({}));
    await openCard(el, "С 07:00");
    expect(el.textContent).toContain("Проверка 47.pdf");
    await act(async () => buttonByText(el, "Убрать файл").click());
    await settle();
    expect(remove).toHaveBeenCalledWith(1);
  });

  it("сохраняет пояснение и ссылку своего чек-листа", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    const save = vi.spyOn(apiClient, "patchChecklist").mockResolvedValue(checklist({}));
    await openCard(el, "С 07:00");
    const note = el.querySelector<HTMLTextAreaElement>("#checklist-note-1")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Обходим по часовой");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText(el, "Сохранить инструкцию").click());
    await settle();
    expect(save).toHaveBeenCalledWith(1, { note: "Обходим по часовой", docUrl: null });
  });

  it("сводка дня называет каждому его чек-лист", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })], {
      date: "2026-08-24",
      people: [{ employeeId: 3, displayName: "Волков Марк", checklistId: 1, checklistName: "С 07:00", done: 1, total: 2 }],
    });
    expect(el.textContent).toContain("Волков Марк");
    expect(el.textContent).toContain("1 из 2");
  });
});
