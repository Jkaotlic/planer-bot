// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./api/client";
import { App } from "./App";
import { addDays, mondayOf, toISODate } from "./lib/week";

/**
 * «📅 Заполнить неделю» в «Расписании» консоли — проводка от кнопки в шапке
 * до графика.
 *
 * Три звена, и каждое рвалось бы молча: кнопка открывает панель на ПОКАЗАННУЮ
 * неделю (не на сегодняшнюю — заполняют обычно следующую), итог говорится
 * вслух, и сетка перечитывается — иначе заполненная неделя выглядела бы
 * пустой, и её заполнили бы второй раз.
 */

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

function buttonWith(el: ParentNode, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`нет кнопки с текстом «${text}»`);
  return found as HTMLButtonElement;
}

async function click(el: HTMLElement) {
  await act(async () => el.click());
  await settle(4);
}

const NEXT_MONDAY = toISODate(addDays(mondayOf(new Date()), 7));

describe("«Заполнить неделю» в консоли", () => {
  it("заполняет показанную неделю, говорит итог и перечитывает график", async () => {
    const el = await mount();
    await click(el.querySelector("[aria-label='Следующая неделя']") as HTMLElement);
    const create = vi.spyOn(apiClient, "createEntries").mockResolvedValue({ created: 1, notified: { delivered: 1, intended: 1 } });
    const reread = vi.spyOn(apiClient, "getTeamSchedule");

    await click(buttonWith(el, "Заполнить неделю"));
    const panel = el.querySelector<HTMLElement>(".fill-week-panel");
    expect(panel).not.toBeNull();

    await click(panel!.querySelector<HTMLButtonElement>(".person-picker-row")!);
    const monday = panel!.querySelector<HTMLSelectElement>(".fill-week-day select")!;
    await act(async () => {
      monday.value = monday.options[1]!.value;
      monday.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click(buttonWith(panel!, "Заполнить (1)"));
    await settle();

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0][0]!.date).toBe(NEXT_MONDAY);
    expect(el.querySelector(".fill-week-panel")).toBeNull();
    expect(el.querySelector(".roster-notice")?.textContent ?? "").toContain("Заполнено дней: 1.");
    expect(reread).toHaveBeenCalledWith(NEXT_MONDAY, toISODate(addDays(mondayOf(new Date()), 13)));
  });

  it("«Отмена» закрывает панель без запроса", async () => {
    const el = await mount();
    const create = vi.spyOn(apiClient, "createEntries");

    await click(buttonWith(el, "Заполнить неделю"));
    await click(buttonWith(el.querySelector(".fill-week-panel")!, "Отмена"));

    expect(el.querySelector(".fill-week-panel")).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
