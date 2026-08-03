// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api/client";
import { App } from "./App";
import { addDays, mondayOf, toISODate } from "./lib/week";

/**
 * «⬇ Выгрузить CSV» стоит в одной полосе с переключателем недель — значит выгружает
 * то, на что админ смотрит. Кнопка брала месяц по системным часам, поэтому из консоли
 * нельзя было выгрузить никакой месяц, кроме текущего: график на следующий месяц —
 * ровно то, ради чего файл и качают.
 *
 * Мобильное зеркало (`AdminRosterCsv`, `monthRangeOf(selectedDate)`) так и делает
 * с самого начала; расходилась именно консоль.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  // jsdom не умеет ни то, ни другое: скачивание тут не проверяется, только запрос.
  (URL as unknown as { createObjectURL: unknown }).createObjectURL = vi.fn(() => "blob:test");
  (URL as unknown as { revokeObjectURL: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.restoreAllMocks();
});

async function settle(times = 20) {
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
    root!.render(createElement(App));
  });
  await settle();
  return host;
}

function byText(el: HTMLElement, selector: string, text: string): HTMLElement {
  const found = [...el.querySelectorAll(selector)].find((node) => (node.textContent ?? "").trim() === text);
  if (!found) throw new Error(`не нашёл ${selector} с подписью «${text}»`);
  return found as HTMLElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle();
}

/** Месяц вокруг даты, как его пишет выгрузка: первое число .. последнее. */
function monthOf(iso: string): { from: string; to: string } {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
}

/** Пять недель вперёд — 35 дней, то есть всегда другой месяц, в любой день года. */
const SHOWN = toISODate(addDays(mondayOf(new Date()), 35));

describe("выгрузка CSV из консоли", () => {
  it("берёт месяц показанной недели, а не сегодняшний", async () => {
    const el = await mount();
    const csv = vi.spyOn(apiClient, "getRosterCsv").mockResolvedValue("csv");

    for (let i = 0; i < 5; i += 1) {
      await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);
    }
    await click(byText(el, "button", "⬇ Выгрузить CSV"));

    const expected = monthOf(SHOWN);
    expect(csv).toHaveBeenCalledWith(expected.from, expected.to);
  });

  it("говорит, за какой период выгрузила", async () => {
    const el = await mount();
    vi.spyOn(apiClient, "getRosterCsv").mockResolvedValue("csv");

    for (let i = 0; i < 5; i += 1) {
      await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);
    }
    await click(byText(el, "button", "⬇ Выгрузить CSV"));

    const { from, to } = monthOf(SHOWN);
    const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    expect(el.querySelector(".roster-notice")?.textContent ?? "").toContain(`${ru(from)} — ${ru(to)}`);
  });

  it("на текущей неделе по-прежнему выгружает текущий месяц", async () => {
    const el = await mount();
    const csv = vi.spyOn(apiClient, "getRosterCsv").mockResolvedValue("csv");

    await click(byText(el, "button", "⬇ Выгрузить CSV"));

    const expected = monthOf(toISODate(mondayOf(new Date())));
    expect(csv).toHaveBeenCalledWith(expected.from, expected.to);
  });
});
