// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ChecklistCard } from "./ChecklistCard";
import { apiClient, type MyChecklist } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-08-24";
const ITEMS = [
  { id: 1, title: "Обойти этаж", note: "По часовой, от лифтов" },
  { id: 2, title: "Проверить переговорные", note: null },
];

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

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(ChecklistCard, { today: TODAY })));
  });
  await settle();
  return host;
}

const state = (over: Partial<MyChecklist> = {}): MyChecklist => ({
  date: TODAY, required: true, items: ITEMS, markedItemIds: [],
  note: null, docUrl: null, docName: null, ...over,
});

describe("карточка чек-листа", () => {
  it("не появляется в день, когда чек-лист не положен", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ required: false, items: [] }));
    const el = await mount();
    expect(el.textContent).toBe("");
  });

  // Пустой список — не «не положен», но показывать нечего, и заголовок над
  // пустотой читался бы как «пункты не загрузились».
  it("не появляется, когда пунктов ноль", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ items: [] }));
    const el = await mount();
    expect(el.textContent).toBe("");
  });

  it("показывает пункты и сколько сделано", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ markedItemIds: [1] }));
    const el = await mount();
    expect(el.textContent).toContain("Обойти этаж");
    expect(el.textContent).toContain("Проверить переговорные");
    expect(el.textContent).toContain("Сделано 1 из 2");
  });

  /**
   * Отметка уходит на сервер и оттуда же возвращается: держать галочки в
   * состоянии экрана значило бы, что закрытая мини-аппа их теряет, а открытый
   * рядом чат бота показывает другое.
   */
  it("тап по пункту отмечает его на сервере и показывает ответ сервера", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state());
    const mark = vi.spyOn(apiClient, "markChecklistItem").mockResolvedValue(state({ markedItemIds: [2] }));

    const el = await mount();
    const second = [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][1]!;
    await act(async () => second.click());
    await settle();

    expect(mark).toHaveBeenCalledWith(TODAY, 2, true);
    expect(el.textContent).toContain("Сделано 1 из 2");
    expect([...el.querySelectorAll(".checklist-item")][1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("повторный тап снимает отметку", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ markedItemIds: [1] }));
    const mark = vi.spyOn(apiClient, "markChecklistItem").mockResolvedValue(state());
    const el = await mount();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][0]!.click());
    expect(mark).toHaveBeenCalledWith(TODAY, 1, false);
  });

  it("отказ сервера говорит вслух, а не молча теряет отметку", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state());
    vi.spyOn(apiClient, "markChecklistItem").mockRejectedValue(new Error("Сеть недоступна"));
    const el = await mount();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][0]!.click());
    await settle();
    expect(el.textContent).toContain("Сеть недоступна");
  });

  it("показывает пояснение к пункту под ним, а не в подписи", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state());
    const el = await mount();
    const first = el.querySelectorAll(".checklist-item")[0]!;
    expect(first.querySelector(".checklist-item__title")!.textContent).toBe("Обойти этаж");
    expect(first.textContent).toContain("По часовой, от лифтов");
  });

  it("показывает общее пояснение над списком", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ note: "Начинаем с 47-го" }));
    const el = await mount();
    expect(el.textContent).toContain("Начинаем с 47-го");
  });

  it("ссылку на документ даёт ссылкой, по которой можно уйти", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ docUrl: "https://disk.example/47.pdf" }));
    const el = await mount();
    const link = el.querySelector<HTMLAnchorElement>("a.checklist-doc-link")!;
    expect(link.href).toBe("https://disk.example/47.pdf");
  });

  // Файл живёт в Telegram, мини-апп его не покажет. Молчать про него нельзя:
  // человек прочитает «инструкция есть» и пойдёт искать её здесь.
  it("про файл говорит, что он в чате, и не притворяется, что покажет его", async () => {
    vi.spyOn(apiClient, "getMyChecklist").mockResolvedValue(state({ docName: "Проверка 47.pdf" }));
    const el = await mount();
    expect(el.textContent).toContain("Проверка 47.pdf");
    expect(el.textContent).toContain("в чате с ботом");
  });
});
