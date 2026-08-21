// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ChecklistCard } from "./ChecklistCard";
import { apiClient, type MyChecklist } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TODAY = "2026-08-24";
const ITEMS = [{ id: 1, title: "Обойти этаж" }, { id: 2, title: "Проверить переговорные" }];

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
  date: TODAY, required: true, items: ITEMS, markedItemIds: [], ...over,
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
});
