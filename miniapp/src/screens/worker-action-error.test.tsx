// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type SwapRequest, type WeekendSlotView } from "../api/client";
import { App } from "../App";

/**
 * Тот же класс дефекта, что у «🔗 Ссылка» (`c4da857`) и у отказов в строке
 * работника (`8bc62bb`): ответ на нажатие в карточке рисуется НЕ в этой карточке,
 * а общим блоком под заголовком экрана.
 *
 * Мини-апп — один длинный скролл без единого оверлея, поэтому «наверху экрана»
 * значит «за пределами видимости», как только карточек больше двух. Замер в
 * Chromium на 390×844 (DEV-мок): на «Выходных» вторая кнопка «🙋 Хочу» стоит на
 * y=690 при прокрутке 267 — блок ошибки в этот момент на y=−134, то есть выше
 * верхнего края. На «Обменах» с тремя входящими заявками третья «Принять» лежит
 * на y=846 при окне 844, а ошибка так и остаётся наверху документа.
 *
 * Тест держит то же самое без пикселей: отказ обязан лежать между кнопкой своей
 * карточки и кнопкой следующей — то есть внутри карточки, на которую нажали.
 */

// React проверяет этот флаг, чтобы разрешить `act` вне тест-раннера с DOM.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function swap(id: number): SwapRequest {
  return {
    id,
    direction: "incoming",
    status: "pending",
    message: null,
    createdAt: `2026-08-0${id}T10:00:00.000Z`,
    counterpartyName: `Коллега ${id}`,
    yourShift: { date: "2026-08-10", start: "09:00", end: "18:00", title: "День" },
    theirShift: { date: "2026-08-11", start: "08:00", end: "17:00", title: "Утро" },
  };
}

function slot(id: number): WeekendSlotView {
  return {
    slot: {
      id,
      date: "2026-08-15",
      start: "10:00",
      end: "18:00",
      title: `Смена ${id}`,
      location: null,
      note: null,
      status: "open",
    },
    interested: false,
    assignees: [],
  };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.spyOn(apiClient, "getSwaps").mockResolvedValue([swap(1), swap(2), swap(3)]);
  vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([slot(11), slot(12), slot(13)]);
  vi.spyOn(apiClient, "getWeekendOffers").mockResolvedValue([]);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
}

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(App)));
  });
  await settle();
  return host;
}

function buttons(el: HTMLElement, label: string): HTMLButtonElement[] {
  return [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === label) as HTMLButtonElement[];
}

/** Вкладка нижней панели: telegram-ui рисует `Tabbar.Item` не кнопкой. */
function tab(el: HTMLElement, label: string): HTMLElement {
  const found = [...el.querySelectorAll(".tab-bar-fit *")].find((node) => (node.textContent ?? "").trim() === label);
  if (!found) throw new Error(`нет вкладки «${label}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

/** Узел с этим текстом — где он лежит относительно кнопок карточек. */
function errorNode(el: HTMLElement, text: string): HTMLElement {
  const found = [...el.querySelectorAll("div")].find(
    (d) => d.children.length === 0 && (d.textContent ?? "").includes(text),
  );
  if (!found) throw new Error(`на экране нет отказа «${text}»`);
  return found as HTMLElement;
}

function follows(node: Node, after: Node): boolean {
  return (after.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe("отказ на действие в карточке остаётся в этой карточке", () => {
  it("«Обмены»: отказ на «Принять» лежит в своей карточке, а не над списком", async () => {
    const el = await mount();
    await click(tab(el, "Обмены"));

    const accepts = buttons(el, "Принять");
    expect(accepts.length).toBe(3);

    vi.spyOn(apiClient, "acceptSwap").mockRejectedValue(new Error("Failed to fetch"));
    const target = accepts[1]!;
    await click(target);

    const error = errorNode(el, "Не получилось принять обмен");
    // После кнопки своей карточки и до кнопки следующей — значит внутри неё.
    expect(follows(error, target)).toBe(true);
    expect(follows(error, buttons(el, "Принять")[2]!)).toBe(false);
  });

  it("«Выходные»: отказ на «🙋 Хочу» лежит в своей карточке, а не над списком", async () => {
    const el = await mount();
    await click(tab(el, "Выходные"));

    const wants = buttons(el, "🙋 Хочу");
    expect(wants.length).toBe(3);

    vi.spyOn(apiClient, "expressInterest").mockRejectedValue(new Error("Failed to fetch"));
    const target = wants[1]!;
    await click(target);

    const error = errorNode(el, "Не получилось записаться");
    expect(follows(error, target)).toBe(true);
    expect(follows(error, buttons(el, "🙋 Хочу")[2]!)).toBe(false);
  });

  it("отказ виден у нажатой карточки и не появляется у соседней", async () => {
    const el = await mount();
    await click(tab(el, "Выходные"));

    vi.spyOn(apiClient, "expressInterest").mockRejectedValue(new Error("Failed to fetch"));
    await click(buttons(el, "🙋 Хочу")[1]!);

    const errors = [...el.querySelectorAll("div")].filter(
      (d) => d.children.length === 0 && (d.textContent ?? "").includes("Не получилось записаться"),
    );
    expect(errors.length).toBe(1);
  });
});
