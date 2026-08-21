// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { PersonPicker } from "./PersonPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SIX = [
  { id: 1, displayName: "Иванова Анна" },
  { id: 2, displayName: "Петров Игорь" },
  { id: 3, displayName: "Семёнов Марк" },
  { id: 4, displayName: "Соколова Вера" },
  { id: 5, displayName: "Кузнецов Пётр" },
  { id: 6, displayName: "Орлова Ника" },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
  vi.restoreAllMocks();
});

async function mountPicker(props: Omit<Parameters<typeof PersonPicker>[0], "label">) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(PersonPicker, { label: "Кому", ...props })));
  });
  return host;
}

function rowByName(el: HTMLElement, name: string): HTMLElement {
  const found = [...el.querySelectorAll<HTMLElement>(".person-picker-row")].find(
    (r) => (r.textContent ?? "").includes(name),
  );
  if (!found) throw new Error(`не нашёл строку «${name}»`);
  return found;
}

function selectedRowName(el: HTMLElement): string {
  const row = el.querySelector<HTMLElement>(".person-picker-row.selected");
  return (row?.textContent ?? "").trim();
}

function searchField(el: HTMLElement): HTMLInputElement {
  const found = el.querySelector<HTMLInputElement>('input[aria-label="Поиск по имени"]');
  if (!found) throw new Error("не нашёл поле поиска");
  return found;
}

async function typeSearch(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("выбор одного человека в мини-аппе", () => {
  it("клик по строке отдаёт её id", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 0, onChange });
    await act(async () => { rowByName(el, "Семёнов Марк").click(); });
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("выбранный назван всегда — даже когда поиск его спрятал", async () => {
    const el = await mountPicker({ people: SIX, value: 3, onChange: vi.fn() });
    await typeSearch(searchField(el), "орлова");
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("Семёнов Марк");
  });

  it("строка «Выбран» несёт пометку — список со скроллом может её спрятать в самой строке", async () => {
    // Список ограничен maxHeight со скроллом: на паре десятков человек выбранная
    // строка с пометкой запросто вне видимой области, а «Выбран» — единственное,
    // что тогда напоминает про «этого бот сам бы не поставил».
    const el = await mountPicker({
      people: SIX,
      value: 2,
      onChange: vi.fn(),
      note: (p) => (p.id === 2 ? "· вне назначений" : null),
    });
    expect(el.querySelector(".person-picker-chosen")!.textContent).toContain("вне назначений");
  });

  it("поиск не меняет выбор: набрал, стёр — выбран тот же", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange });
    await typeSearch(searchField(el), "орлова");
    await typeSearch(searchField(el), "");
    expect(onChange).not.toHaveBeenCalled();
    expect(selectedRowName(el)).toContain("Семёнов Марк");
  });

  it("строка «никто» показывается, когда её подпись задана, и выбирается", async () => {
    const onChange = vi.fn();
    const el = await mountPicker({ people: SIX, value: 3, onChange, emptyOptionLabel: "Общий сбор — на всех" });
    await act(async () => { rowByName(el, "Общий сбор — на всех").click(); });
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it("на коротком списке поля поиска нет, сами строки на месте", async () => {
    const el = await mountPicker({ people: SIX.slice(0, 3), value: 0, onChange: vi.fn() });
    expect(el.querySelector('input[aria-label="Поиск по имени"]')).toBeNull();
    expect(el.querySelectorAll(".person-picker-row")).toHaveLength(3);
  });

  it("пометка «вне назначений» переживает замену выпадающего списка", async () => {
    const el = await mountPicker({
      people: SIX,
      value: 0,
      onChange: vi.fn(),
      note: (p) => (p.id === 2 ? "· вне назначений" : null),
    });
    expect(rowByName(el, "Петров Игорь").textContent).toContain("вне назначений");
    expect(rowByName(el, "Семёнов Марк").textContent).not.toContain("вне назначений");
  });
});
