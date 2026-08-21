// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChecklistScreen } from "./ChecklistScreen";
import { apiClient, type ChecklistDay, type ChecklistItem } from "../api/client";

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
    const el = await mount([{ id: 1, title: "Обойти этаж" }, { id: 2, title: "Проверить переговорные" }]);
    const rows = [...el.querySelectorAll(".employee-row-card")];
    expect(rows[0]!.textContent).toContain("1");
    expect(rows[0]!.textContent).toContain("Обойти этаж");
    expect(rows[1]!.textContent).toContain("Проверить переговорные");
  });

  it("добавляет пункт и перечитывает список", async () => {
    const el = await mount([]);
    const add = vi.spyOn(apiClient, "addChecklistItem").mockResolvedValue({ id: 9, title: "Новый" });
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
    const el = await mount([{ id: 1, title: "Обойти этаж" }]);
    const remove = vi.spyOn(apiClient, "removeChecklistItem").mockResolvedValue([]);
    await act(async () => buttonByText(el, "Убрать").click());
    await settle();
    expect(remove).toHaveBeenCalledWith(1);
  });

  it("показывает, кто сегодня сколько отметил", async () => {
    const el = await mount(
      [{ id: 1, title: "Обойти этаж" }, { id: 2, title: "Проверить переговорные" }],
      { date: "2026-08-24", total: 2, people: [{ employeeId: 3, displayName: "Волков Марк", done: 1 }] },
    );
    expect(el.textContent).toContain("Волков Марк");
    expect(el.textContent).toContain("1 из 2");
  });

  it("никому не положен — говорит об этом прямо", async () => {
    const el = await mount([{ id: 1, title: "Обойти этаж" }]);
    expect(el.textContent).toContain("Сегодня чек-лист никому не положен");
  });
});
