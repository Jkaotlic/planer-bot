// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_CALENDAR } from "@planer/shared";
import type { Shift } from "../api/client";
import { WeekShortfallBar, type WeekShortfallBarProps } from "./WeekShortfallBar";

/**
 * Строка над сеткой недели: «Не хватает 4: Пн Утро −1 · Чт Дежурство −2».
 *
 * Строка стоит всегда: закрытая неделя — зелёная «Нормы закрыты ✓», без норм —
 * нейтральная «Нормы не заданы». Молчание читалось как «подсказки нет» —
 * владелец не знал, что она вообще существует.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = ["2026-08-24", "2026-08-25", "2026-08-26", "2026-08-27", "2026-08-28", "2026-08-29", "2026-08-30"];
const MORNING = { templateId: 10, name: "Утро", category: "shift" as const, coverage: [2, 0, 0, 1, 0, 0, 0] };
const DUTY = { templateId: 20, name: "Дежурство", category: "duty" as const, coverage: [1, 0, 0, 0, 0, 0, 0] };
const EVENING = { templateId: 30, name: "Вечер", category: "shift" as const, coverage: [0, 0, 0, 0, 0, 0, 0] };

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function mount(props: Partial<WeekShortfallBarProps>) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(WeekShortfallBar, {
      shifts: [], templates: [], weekDates: WEEK, calendar: EMPTY_CALENDAR, pointedDate: null, onPointDay: () => {}, onOpenKinds: () => {}, ...props,
    }));
  });
  return host;
}

const entry = (id: number, date: string, employeeId: number, templateId: number): Shift => ({
  id, date, endDate: null, start: "08:00", end: "17:00", employeeId,
  category: "shift", templateId, title: null, location: null, unrecognisedCode: null,
});

describe("строка нехватки над сеткой недели", () => {
  it("закрытая неделя — зелёная «Нормы закрыты ✓»", async () => {
    const shifts = [entry(1, WEEK[0]!, 1, 10), entry(2, WEEK[0]!, 2, 10), entry(3, WEEK[3]!, 1, 10)];
    const el = await mount({ shifts, templates: [MORNING] });
    expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("closed");
    expect(el.textContent).toBe("Нормы закрыты ✓");
  });

  it("нормы не заданы ни у одного вида — нейтральная, с кнопкой «задать →»", async () => {
    const onOpenKinds = vi.fn();
    const el = await mount({ templates: [EVENING], onOpenKinds });
    expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("no-norms");
    expect(el.textContent).toContain("Нормы не заданы");
    const set = [...el.querySelectorAll("button")].find((b) => b.textContent === "задать →")!;
    await act(async () => set.click());
    expect(onOpenKinds).toHaveBeenCalledTimes(1);
  });

  it("дыра — data-shortfall=short и прежний расклад", async () => {
    const el = await mount({ templates: [MORNING] });
    expect(el.querySelector(".week-shortfall")?.getAttribute("data-shortfall")).toBe("short");
    expect(el.textContent).toContain("Не хватает 3");
  });

  it("итог — числом людей, отдельным узлом в начале строки", async () => {
    const el = await mount({ templates: [MORNING, DUTY] });
    expect(el.querySelector(".week-shortfall-total")!.textContent).toBe("Не хватает 4");
    expect(el.querySelector(".week-shortfall")!.firstElementChild!.className).toBe("week-shortfall-total");
  });

  it("называет каждый день с дырой и что в нём не закрыто", async () => {
    const el = await mount({ templates: [MORNING, DUTY] });
    const days = [...el.querySelectorAll(".week-shortfall-day")].map((b) => b.textContent);
    expect(days).toEqual(["Пн Утро −2, Дежурство −1", "Чт Утро −1"]);
  });

  it("клик по дню показывает на его колонку, повторный — снимает", async () => {
    const onPointDay = vi.fn();
    const el = await mount({ templates: [MORNING], onPointDay });
    await act(async () => el.querySelectorAll<HTMLButtonElement>(".week-shortfall-day")[1]!.click());
    expect(onPointDay).toHaveBeenLastCalledWith(WEEK[3]);

    await act(async () => root!.unmount());
    const again = await mount({ templates: [MORNING], onPointDay, pointedDate: WEEK[3]! });
    const pressed = again.querySelector<HTMLButtonElement>(".week-shortfall-day[aria-pressed='true']")!;
    expect(pressed.textContent).toContain("Чт");
    await act(async () => pressed.click());
    expect(onPointDay).toHaveBeenLastCalledWith(null);
  });

  it("виды без нормы — ссылкой-кнопкой в конце строки, и она ведёт в «Виды смен»", async () => {
    const onOpenKinds = vi.fn();
    const el = await mount({ templates: [MORNING, EVENING], onOpenKinds });
    const tail = el.querySelector<HTMLButtonElement>(".week-shortfall-unset")!;
    expect(tail.textContent).toBe("без нормы: 1 вид →");
    expect(tail.title).toBe("Норма не задана: Вечер");
    // Хвост — последним: сперва то, что надо закрыть сегодня, потом настройка.
    expect(el.querySelector(".week-shortfall")!.lastElementChild).toBe(tail);
    await act(async () => tail.click());
    expect(onOpenKinds).toHaveBeenCalledTimes(1);
  });

  it("дыр нет, а виды без нормы есть — вместо итога один хвост", async () => {
    const shifts = [entry(1, WEEK[0]!, 1, 10), entry(2, WEEK[0]!, 2, 10), entry(3, WEEK[3]!, 1, 10)];
    const el = await mount({ shifts, templates: [MORNING, EVENING, { ...EVENING, templateId: 31, name: "Ночь" }] });
    expect(el.querySelector(".week-shortfall")!.textContent).toBe("Нормы закрыты ✓без нормы: 2 вида →");
  });
});
