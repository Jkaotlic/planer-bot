// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecklistScreen } from "./ChecklistScreen";
import { CHECKLIST_RULE_TEXT } from "@planer/shared";
import { apiClient, type Checklist, type ChecklistDay, type ChecklistItem, type Template } from "../api/client";

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

const item = (over: Partial<ChecklistItem> = {}): ChecklistItem => ({ id: 1, title: "Открыть 47-й", note: null, ...over });

const person = (over: Partial<ChecklistDay["people"][number]>): ChecklistDay["people"][number] => ({
  employeeId: 3, displayName: "Марк", checklistId: 1, checklistName: "С 07:00",
  done: 0, total: 2, start: "07:00", delivery: "scheduled", sentAt: null, ...over,
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

/** Надпись на бейдже карточки — то, что видно, не вчитываясь. */
function badgeOf(el: HTMLElement, name: string): string {
  const head = [...el.querySelectorAll<HTMLElement>(".kind-card-head")].find((b) => (b.textContent ?? "").includes(name));
  if (!head) throw new Error(`не нашёл карточку «${name}»`);
  const badge = head.querySelector(".checklist-badge");
  if (!badge) throw new Error(`у карточки «${name}» нет бейджа`);
  return (badge.textContent ?? "").trim();
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
    expect(el.querySelector(".kind-card-head")!.textContent).toContain("не выбран вид смены");
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
   * Файл ложится на диск сервера: браузер не умеет положить документ в Telegram
   * так, чтобы бот потом мог его переслать, — пересылку берёт на себя бот при
   * первой рассылке. Путь через `/instruction` остался вторым, и экран обязан
   * его назвать.
   */
  it("даёт выбрать файл и называет второй путь — через бота", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    await openCard(el, "С 07:00");
    // Поле файла есть с тех пор, как у сервера появилось своё хранилище.
    expect(el.querySelector('input[type="file"]')).not.toBeNull();
    // Путь через бота остался написан рядом: он короче, когда файл уже в телефоне.
    expect(el.textContent).toContain("/instruction");
    expect(el.textContent).toContain("выбрать «С 07:00»");
  });

  it("отправляет выбранный файл на сервер", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    const upload = vi.spyOn(apiClient, "uploadChecklistDoc").mockResolvedValue(checklist({ id: 1, hasDoc: true, docName: "Проверка 47.pdf" }));
    await openCard(el, "С 07:00");

    const input = el.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["x"], "Проверка 47.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();

    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0]![0]).toBe(1);
    expect((upload.mock.calls[0]![1] as File).name).toBe("Проверка 47.pdf");
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
      people: [person({ displayName: "Волков Марк", done: 1 })],
    });
    expect(el.textContent).toContain("Волков Марк");
    expect(el.textContent).toContain("1 из 2");
  });

  /**
   * Ровно та непонятность, ради которой правка: заполнил админ список или нет и
   * уйдёт ли он кому-нибудь — по экрану было не понять.
   */
  it("шапка карточки говорит, уходит список и кому", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", items: [item()], templateIds: [6] })]);
    expect(badgeOf(el, "С 07:00")).toBe("Уходит");
    expect(el.textContent).toContain("Дежурство с 07:00");
  });

  it("заполненный, но никому не назначенный список назван неуходящим", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", items: [item()], templateIds: [] })]);
    expect(badgeOf(el, "С 07:00")).toBe("Не уходит");
    expect(el.textContent).toContain("не выбран вид смены");
  });

  it("назначенный, но пустой список назван неуходящим — и всё равно называет, кому назначен", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", items: [], templateIds: [6] })]);
    expect(badgeOf(el, "С 07:00")).toBe("Не уходит");
    expect(el.textContent).toContain("ни пунктов, ни пояснения, ни файла");
    expect(el.textContent).toContain("Назначен: Дежурство с 07:00");
  });

  // Пунктов нет, а пояснение есть — бот такое шлёт с 2026-08-26, и экран обязан
  // говорить то же самое.
  it("список с одним пояснением показан уходящим", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", note: "Обход от лифтов", templateIds: [6] })]);
    expect(badgeOf(el, "С 07:00")).toBe("Уходит");
  });

  it("внутри карточки написано правило: кому и когда уходит", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00", items: [item()], templateIds: [6] })]);
    await openCard(el, "С 07:00");
    expect(el.textContent).toContain(CHECKLIST_RULE_TEXT);
  });

  /**
   * Главное, чего не хватало 2026-08-28: сводка жила ПОД карточками, и вопрос
   * «уходило сегодня хоть что-нибудь» требовал сначала пролистать настройки.
   */
  it("сводка дня стоит первой, до карточек", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })], {
      date: "2026-08-24",
      people: [person({ displayName: "Марк" })],
    });
    const text = el.textContent ?? "";
    expect(text.indexOf("Сегодня")).toBeLessThan(text.indexOf("С 07:00"));
  });

  it("итог дня назван числами: сколько ушло, сколько ждёт, сколько не уйдёт", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })], {
      date: "2026-08-24",
      people: [
        person({ employeeId: 3, delivery: "sent", sentAt: "07:02" }),
        person({ employeeId: 4, delivery: "sent", sentAt: "08:02" }),
        person({ employeeId: 5, delivery: "scheduled" }),
        person({ employeeId: 6, delivery: "no-telegram" }),
      ],
    });
    expect(el.textContent).toContain("Ушло 2");
    expect(el.textContent).toContain("Ждёт 1");
    expect(el.textContent).toContain("Не уйдёт 1");
  });

  // «Ушло в 07:02» — ответ, для которого не нужно верить экрану на слово.
  it("называет час, в который сообщение ушло", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })], {
      date: "2026-08-24",
      people: [person({ delivery: "sent", sentAt: "07:02" })],
    });
    expect(el.textContent).toContain("ушло в 07:02");
  });

  it("сегодня никому не положен — так и сказано", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    expect(el.textContent).toContain("Сегодня чек-лист никому не положен");
  });

  it("в сводке дня видно время отправки и её исход", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })], {
      date: "2026-08-24",
      people: [
        person({ employeeId: 3, displayName: "Марк", start: "07:00", delivery: "sent" }),
        person({ employeeId: 4, displayName: "Аня", start: "08:00", delivery: "scheduled" }),
        person({ employeeId: 5, displayName: "Игорь", start: "07:00", delivery: "no-telegram" }),
      ],
    });
    expect(el.textContent).toContain("уже отправлено");
    expect(el.textContent).toContain("уйдёт в 08:00");
    expect(el.textContent).toContain("не уйдёт: нет Telegram");
  });

  /**
   * Пояснение и ссылка сохраняются кнопкой, а виды смен и пункты — сразу по
   * клику. Разница ничем не показывалась, и уйти с экрана, потеряв текст, можно
   * было молча.
   */
  it("говорит, что правка ещё не сохранена, и подтверждает сохранение", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    const saved = checklist({ id: 1, name: "С 07:00", note: "Обходим по часовой" });
    vi.spyOn(apiClient, "patchChecklist").mockResolvedValue(saved);
    // Перечитывание после правки отдаёт уже сохранённый текст — так ведёт себя
    // сервер, и именно на этом держится признак «сохранено».
    vi.spyOn(apiClient, "getChecklists").mockResolvedValue([saved]);
    await openCard(el, "С 07:00");
    expect(el.textContent).not.toContain("Не сохранено");

    const note = el.querySelector<HTMLTextAreaElement>("#checklist-note-1")!;
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

  // Экран годами обещал обратное: «пока в списке нет пунктов, бот по нему ничего
  // не присылает» перестало быть правдой 2026-08-26.
  it("не обещает молчания по спискам без пунктов", async () => {
    const el = await mount([checklist({ id: 1, name: "С 07:00" })]);
    expect(el.textContent).not.toContain("Пока в списке нет пунктов, бот по нему ничего не присылает");
  });
});
