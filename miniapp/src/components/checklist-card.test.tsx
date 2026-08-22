// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { ChecklistCard } from "./ChecklistCard";
import { apiClient, type MyChecklistView } from "../api/client";

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

const view = (over: Partial<MyChecklistView> = {}): MyChecklistView => ({
  id: 1, name: "Дежурство с 07:00", items: ITEMS, markedItemIds: [],
  note: null, docUrl: null, docName: null, ...over,
});
const state = (over: Partial<MyChecklistView> = {}) => ({ date: TODAY, checklists: [view(over)] });

describe("карточка чек-листа", () => {
  it("не появляется в день, когда чек-лист не положен", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue({ date: TODAY, checklists: [] });
    const el = await mount();
    expect(el.textContent).toBe("");
  });

  // Пустой список — не «не положен», но показывать нечего, и заголовок над
  // пустотой читался бы как «пункты не загрузились».
  it("не появляется, когда сервер не прислал ни одного списка", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue({ date: TODAY, checklists: [] });
    const el = await mount();
    expect(el.textContent).toBe("");
  });

  it("показывает пункты и сколько сделано", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ markedItemIds: [1] }));
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
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state());
    const mark = vi.spyOn(apiClient, "markChecklistItem").mockResolvedValue({ checklistId: 1, markedItemIds: [2] });

    const el = await mount();
    const second = [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][1]!;
    await act(async () => second.click());
    await settle();

    expect(mark).toHaveBeenCalledWith(TODAY, 2, true);
    expect(el.textContent).toContain("Сделано 1 из 2");
    expect([...el.querySelectorAll(".checklist-item")][1]!.getAttribute("aria-pressed")).toBe("true");
  });

  it("повторный тап снимает отметку", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ markedItemIds: [1] }));
    const mark = vi.spyOn(apiClient, "markChecklistItem").mockResolvedValue({ checklistId: 1, markedItemIds: [] });
    const el = await mount();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][0]!.click());
    expect(mark).toHaveBeenCalledWith(TODAY, 1, false);
  });

  it("отказ сервера говорит вслух, а не молча теряет отметку", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state());
    vi.spyOn(apiClient, "markChecklistItem").mockRejectedValue(new Error("Сеть недоступна"));
    const el = await mount();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][0]!.click());
    await settle();
    expect(el.textContent).toContain("Сеть недоступна");
  });

  it("показывает пояснение к пункту под ним, а не в подписи", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state());
    const el = await mount();
    const first = el.querySelectorAll(".checklist-item")[0]!;
    expect(first.querySelector(".checklist-item__title")!.textContent).toBe("Обойти этаж");
    expect(first.textContent).toContain("По часовой, от лифтов");
  });

  it("показывает общее пояснение над списком", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ note: "Начинаем с 47-го" }));
    const el = await mount();
    expect(el.textContent).toContain("Начинаем с 47-го");
  });

  it("ссылку на документ даёт ссылкой, по которой можно уйти", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ docUrl: "https://disk.example/47.pdf" }));
    const el = await mount();
    const link = el.querySelector<HTMLAnchorElement>("a.checklist-doc-link")!;
    expect(link.href).toBe("https://disk.example/47.pdf");
  });

  // Файл живёт в Telegram, мини-апп его не покажет. Молчать про него нельзя:
  // человек прочитает «инструкция есть» и пойдёт искать её здесь.
  it("про файл говорит, что он в чате, и не притворяется, что покажет его", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ docName: "Проверка 47.pdf" }));
    const el = await mount();
    expect(el.textContent).toContain("Проверка 47.pdf");
    expect(el.textContent).toContain("в чате с ботом");
  });

  /** Ровно то, ради чего чек-листы стали именованными: список назван по имени. */
  it("называет чек-лист его именем", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue(state({ name: "Дежурство с 07:00" }));
    const el = await mount();
    expect(el.textContent).toContain("Дежурство с 07:00");
  });

  // У человека в день бывают две записи разных видов — и каждая приносит свою
  // процедуру. Показать только одну значило бы утаить половину работы.
  it("показывает оба чек-листа, если сегодня положены два", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue({
      date: TODAY,
      checklists: [
        view({ id: 1, name: "С 07:00", items: [{ id: 1, title: "Открыть 47-й", note: null }] }),
        view({ id: 2, name: "С 08:00", items: [{ id: 9, title: "Проверить переговорные", note: null }] }),
      ],
    });
    const el = await mount();
    expect(el.textContent).toContain("С 07:00");
    expect(el.textContent).toContain("Открыть 47-й");
    expect(el.textContent).toContain("С 08:00");
    expect(el.textContent).toContain("Проверить переговорные");
  });

  // Ответ сервера про один список не должен трогать соседний: это разные
  // процедуры разных смен, и перепутать их отметки нельзя.
  it("отметка в одном списке не трогает второй", async () => {
    vi.spyOn(apiClient, "getMyChecklists").mockResolvedValue({
      date: TODAY,
      checklists: [
        view({ id: 1, name: "С 07:00", items: [{ id: 1, title: "Открыть 47-й", note: null }] }),
        view({ id: 2, name: "С 08:00", items: [{ id: 9, title: "Проверить переговорные", note: null }] }),
      ],
    });
    vi.spyOn(apiClient, "markChecklistItem").mockResolvedValue({ checklistId: 2, markedItemIds: [9] });
    const el = await mount();
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".checklist-item")][1]!.click());
    await settle();

    const items = [...el.querySelectorAll(".checklist-item")];
    expect(items[0]!.getAttribute("aria-pressed")).toBe("false");
    expect(items[1]!.getAttribute("aria-pressed")).toBe("true");
  });
});
