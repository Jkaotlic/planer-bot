// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecklistScreen } from "./ChecklistScreen";
import { apiClient, type ChecklistDay, type ChecklistItem, type ChecklistSettings } from "../api/client";

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

const DAY: ChecklistDay = { date: "2026-08-24", total: 2, people: [] };

async function mount(items: ChecklistItem[], day: ChecklistDay = DAY) {
  vi.spyOn(apiClient, "getChecklistItems").mockResolvedValue(items);
  vi.spyOn(apiClient, "getChecklistDay").mockResolvedValue(day);
  if (!vi.isMockFunction(apiClient.getChecklistSettings)) {
    vi.spyOn(apiClient, "getChecklistSettings").mockResolvedValue({ note: null, docUrl: null, docName: null, hasDoc: false });
  }
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => { root!.render(createElement(ChecklistScreen)); });
  await settle();
  return host;
}

function buttonByText(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл кнопку «${text}»`);
  return found;
}

describe("экран «Чек-лист»", () => {
  /**
   * Пустой список — не поломка, а состояние по умолчанию: содержимое проверки
   * пишет команда. Экран обязан сказать это словами, иначе «бот ничего не
   * присылает» выглядит багом.
   */
  it("пустой список объясняет себя, а не молчит", async () => {
    const el = await mount([]);
    expect(el.textContent).toContain("Пунктов пока нет");
    expect(el.textContent).toContain("бот ничего не присылает");
  });

  it("показывает пункты по порядку, с номерами", async () => {
    const el = await mount([{ id: 1, title: "Обойти этаж", note: null }, { id: 2, title: "Проверить переговорные", note: null }]);
    const rows = [...el.querySelectorAll(".employee-row-card")];
    expect(rows[0]!.textContent).toContain("1");
    expect(rows[0]!.textContent).toContain("Обойти этаж");
    expect(rows[1]!.textContent).toContain("Проверить переговорные");
  });

  it("добавляет пункт и перечитывает список", async () => {
    const el = await mount([]);
    const add = vi.spyOn(apiClient, "addChecklistItem").mockResolvedValue({ id: 9, title: "Новый", note: null });
    const field = el.querySelector<HTMLInputElement>('input[aria-label="Новый пункт"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, "Новый");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText(el, "Добавить").click());
    await settle();
    expect(add).toHaveBeenCalledWith("Новый");
  });

  // «Убрать», а не «Удалить»: пункт гаснет, вчерашние отметки по нему остаются,
  // и слово на кнопке должно обещать ровно это.
  it("кнопка называется «Убрать» и гасит пункт", async () => {
    const el = await mount([{ id: 1, title: "Обойти этаж", note: null }]);
    const remove = vi.spyOn(apiClient, "removeChecklistItem").mockResolvedValue([]);
    await act(async () => buttonByText(el, "Убрать").click());
    await settle();
    expect(remove).toHaveBeenCalledWith(1);
  });

  it("показывает, кто сегодня сколько отметил", async () => {
    const el = await mount(
      [{ id: 1, title: "Обойти этаж", note: null }, { id: 2, title: "Проверить переговорные", note: null }],
      { date: "2026-08-24", total: 2, people: [{ employeeId: 3, displayName: "Волков Марк", done: 1 }] },
    );
    expect(el.textContent).toContain("Волков Марк");
    expect(el.textContent).toContain("1 из 2");
  });

  it("никому не положен — говорит об этом прямо", async () => {
    const el = await mount([{ id: 1, title: "Обойти этаж", note: null }]);
    expect(el.textContent).toContain("Сегодня чек-лист никому не положен");
  });
});

describe("экран «Чек-лист»: инструкция", () => {
  const SETTINGS: ChecklistSettings = { note: null, docUrl: null, docName: null, hasDoc: false };

  async function mountWith(settings: ChecklistSettings = SETTINGS, items: ChecklistItem[] = [{ id: 1, title: "Обойти этаж", note: null }]) {
    vi.spyOn(apiClient, "getChecklistSettings").mockResolvedValue(settings);
    return mount(items, DAY);
  }

  /**
   * Файл кладётся только через бота: браузер не умеет положить документ в
   * Telegram так, чтобы бот потом мог его переслать. Экран обязан сказать, как
   * это сделать, а не молчать про единственный путь.
   */
  it("объясняет, что файл прикладывают через бота", async () => {
    const el = await mountWith();
    expect(el.textContent).toContain("/instruction");
    expect(el.querySelector('input[type="file"]')).toBeNull();
  });

  it("называет приложенный файл и даёт его убрать", async () => {
    const el = await mountWith({ note: null, docUrl: null, docName: "Проверка 47.pdf", hasDoc: true });
    expect(el.textContent).toContain("Проверка 47.pdf");
    const remove = vi.spyOn(apiClient, "removeChecklistDoc").mockResolvedValue(SETTINGS);
    await act(async () => buttonByText(el, "Убрать файл").click());
    await settle();
    expect(remove).toHaveBeenCalled();
  });

  it("сохраняет пояснение и ссылку одной кнопкой", async () => {
    const el = await mountWith();
    const save = vi.spyOn(apiClient, "saveChecklistSettings").mockResolvedValue(SETTINGS);
    const note = el.querySelector<HTMLTextAreaElement>("#checklist-note")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(note, "Обходим по часовой");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonByText(el, "Сохранить").click());
    await settle();
    expect(save).toHaveBeenCalledWith({ note: "Обходим по часовой", docUrl: null });
  });

  it("пояснение к пункту правится отдельно от его подписи", async () => {
    const el = await mountWith();
    const update = vi.spyOn(apiClient, "updateChecklistItem").mockResolvedValue({ id: 1, title: "Обойти этаж", note: "От лифтов" });
    await act(async () => buttonByText(el, "Пояснение").click());
    const field = el.querySelector<HTMLTextAreaElement>('textarea[aria-label^="Пояснение к пункту"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!.call(field, "От лифтов");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = el.querySelector<HTMLButtonElement>(".checklist-item-note button")!;
    await act(async () => save.click());
    await settle();
    expect(update).toHaveBeenCalledWith(1, { note: "От лифтов" });
  });
});
