// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { Me, Shift } from "../api/client";
import { MyShiftsScreen, type MyShiftsScreenProps } from "./MyShiftsScreen";

/**
 * Тап по своей смене (не по «Обменять») раскрывает под строкой список коллег
 * дня — мини-апп один длинный скролл, ответ должен рисоваться там, куда
 * смотрят, а не оверлеем. См. task-3-brief.md.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const me: Me = {
  id: 7, displayName: "Аня Волкова", address: "Аня", preferredName: null,
  isAdmin: false, remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, startTab: null, canAnnounce: false,
};

const TODAY = "2026-09-10";
const MY_SHIFT: Shift = {
  id: 1, date: TODAY, start: "10:00", end: "19:00", endDate: null,
  category: "shift", title: "День", location: null, note: null,
  unrecognisedCode: null, templateId: 1, employeeId: 7,
} as Shift;

const IGOR_COWORKER: Shift = {
  id: 2, date: TODAY, start: "09:00", end: "18:00", endDate: null,
  category: "shift", title: null, location: null, note: null,
  unrecognisedCode: null, templateId: 2, employeeId: 8, employeeName: "Игорь",
} as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(overrides: Partial<MyShiftsScreenProps> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const props: MyShiftsScreenProps = {
    me,
    today: TODAY,
    shifts: [MY_SHIFT],
    templates: [],
    onProposeSwap: vi.fn(),
    onSelfEntry: () => {},
    onRemindersChanged: () => {},
    onSelfScheduleChanged: () => {},
    onStartTabChanged: () => {},
    onAddressChanged: () => {},
    openDay: null,
    openDayLoading: false,
    openDayError: null,
    onToggleCoworkers: vi.fn(),
    ...overrides,
  };
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(MyShiftsScreen, props)));
  });
  return host;
}

function row(el: HTMLElement): HTMLElement {
  const found = el.querySelector('[data-testid="shift-row"]');
  if (!found) throw new Error("строки своей смены нет в разметке");
  return found as HTMLElement;
}

function swapButton(el: HTMLElement): HTMLElement {
  const found = [...el.querySelectorAll("button")].find((b) => b.textContent === "Обменять");
  if (!found) throw new Error("кнопки «Обменять» нет");
  return found;
}

describe("«Кто ещё работает» под своей сменой", () => {
  it("тап по строке зовёт onToggleCoworkers, тап по «Обменять» — нет", async () => {
    const onToggle = vi.fn();
    const onSwap = vi.fn();
    const el = await mount({ onToggleCoworkers: onToggle, onProposeSwap: onSwap });

    await act(async () => swapButton(el).click());
    expect(onSwap).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    await act(async () => row(el).click());
    expect(onToggle).toHaveBeenCalledWith(MY_SHIFT);
  });

  it("раскрытая строка показывает список коллег дня", async () => {
    const el = await mount({ openDay: { date: TODAY, shifts: [IGOR_COWORKER] } });
    await act(async () => row(el).click());
    expect(el.textContent).toContain("Игорь · 09:00–18:00");
  });

  it("пока грузится — «Загружаю…»", async () => {
    const el = await mount({ openDayLoading: true });
    await act(async () => row(el).click());
    expect(el.textContent).toContain("Загружаю");
  });

  it("ошибка загрузки дня показана рядом со строкой", async () => {
    const el = await mount({ openDayError: "Не удалось загрузить, кто работает в этот день." });
    await act(async () => row(el).click());
    expect(el.textContent).toContain("Не удалось загрузить, кто работает в этот день.");
  });

  it("пусто, кроме тебя — сказано словами, а не пустым списком", async () => {
    const el = await mount({ openDay: { date: TODAY, shifts: [] } });
    await act(async () => row(el).click());
    expect(el.textContent).toContain("Никого, кроме тебя");
  });

  it("повторный тап сворачивает список", async () => {
    const el = await mount({ openDay: { date: TODAY, shifts: [IGOR_COWORKER] } });
    await act(async () => row(el).click());
    expect(el.textContent).toContain("Игорь · 09:00–18:00");

    await act(async () => row(el).click());
    expect(el.textContent).not.toContain("Игорь · 09:00–18:00");
  });
});
