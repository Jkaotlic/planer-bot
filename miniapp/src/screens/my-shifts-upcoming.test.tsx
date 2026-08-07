// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { MyShiftsScreen } from "./MyShiftsScreen";
import type { Me, Shift } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const me = {
  id: 7, displayName: "Игорь Петров", address: "Игорь", preferredName: null,
  isAdmin: false, remindersEnabled: true,
} as Me;

let nextId = 1;
function entry(date: string, title: string): Shift {
  return {
    id: nextId++, date, start: "09:00", end: "18:00", endDate: null, category: "shift",
    title, location: null, note: null, unrecognisedCode: null, templateId: 1, employeeId: 7,
  } as Shift;
}

const WEDNESDAY = "2026-08-05";

async function renderScreen(shifts: Shift[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const screen = createElement(MyShiftsScreen, {
    me, today: WEDNESDAY, shifts, templates: [],
    onProposeSwap: () => {}, onRemindersChanged: () => {}, onAddressChanged: () => {},
  });
  await act(async () => root!.render(createElement(AppRoot, null, screen)));
  return host.textContent ?? "";
}

describe("MyShiftsScreen", () => {
  it("рисует секции по неделям и не обещает диапазон, которого нет", async () => {
    const text = await renderScreen([entry("2026-08-06", "День"), entry("2026-08-11", "Утро")]);
    expect(text).toContain("Ближайшие смены");
    expect(text).toContain("Эта неделя");
    expect(text).toContain("Следующая неделя");
  });

  it("говорит, что на этой неделе больше нет смен, но следующие показывает", async () => {
    const text = await renderScreen([entry("2026-08-11", "Утро")]);
    expect(text).toContain("На этой неделе смен больше нет");
    expect(text).toContain("Следующая неделя");
  });

  it("считает сводку по остатку недели, а не по всему будущему", async () => {
    const text = await renderScreen([
      entry("2026-08-06", "День"), entry("2026-08-11", "Утро"), entry("2026-08-12", "Утро"),
    ]);
    expect(text).toContain("Осталось на этой неделе — 1 смена · 9 ч");
  });

  it("прошедшую запись не рисует вовсе", async () => {
    // 1 августа 2026 — суббота позади среды 5-го. Без этой записи в списке
    // нет ничего, кроме неё, поэтому любой её след в тексте выдаёт баг.
    const text = await renderScreen([entry("2026-08-01", "Ночь")]);
    expect(text).not.toContain("Ночь");
    expect(text).not.toContain("1 авг");
  });
});
