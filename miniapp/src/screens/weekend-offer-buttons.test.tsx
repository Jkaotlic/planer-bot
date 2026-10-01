// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { WeekendOffer, WeekendSlotView } from "../api/client";
import { WeekendScreen } from "./WeekendScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

const slot = { id: 1, date: "2026-10-11", start: "10:00", end: "18:00", title: "Праздничная смена", location: "Главный офис", note: null };
const offer = { slot, assignment: { id: 9, status: "offered", hours: 8 } } as unknown as WeekendOffer;
const openSlot = { slot: { ...slot, id: 2, title: "Инвентаризация" }, interested: false, assignees: [] } as unknown as WeekendSlotView;

async function renderScreen(onDecline = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(AppRoot, null,
        createElement(WeekendScreen, {
          slots: [openSlot], offers: [offer],
          busySlotIds: new Set<number>(), busyOfferIds: new Set<number>(),
          slotErrors: new Map<number, string>(), offerErrors: new Map<number, string>(),
          onInterest: vi.fn(), onWithdrawInterest: vi.fn(), onConfirm: vi.fn(), onDecline,
        }),
      ),
    );
  });
  return { el: host, onDecline };
}

const buttonByText = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent!.trim() === text) as HTMLButtonElement | undefined;

describe("«Выходные»: кнопки назначения", () => {
  it("«Беру» — главная, «Не смогу» — обычная; обе своими кнопками и без nowrap-обёртки", async () => {
    const { el } = await renderScreen();
    const take = buttonByText(el, "Беру")!;
    const refuse = buttonByText(el, "Не смогу")!;
    expect(take.className).toContain("ui-btn--primary");
    expect(refuse.className).toContain("ui-btn--secondary");
    expect(refuse.querySelector("h6")).toBeNull();
  });

  it("«Не смогу» по-прежнему переспрашивает: первое нажатие onDecline не зовёт", async () => {
    const { el, onDecline } = await renderScreen();
    await act(async () => buttonByText(el, "Не смогу")!.click());
    expect(onDecline).not.toHaveBeenCalled();
    await act(async () => buttonByText(el, "Да, не смогу")!.click());
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it("бейджа «Выходной» на карточках нет — он повторял название экрана", async () => {
    const { el } = await renderScreen();
    const exact = [...el.querySelectorAll("*")].filter((n) => n.children.length === 0 && n.textContent!.trim() === "Выходной");
    expect(exact).toHaveLength(0);
  });

  it("на экране одна главная кнопка на карточку", async () => {
    const { el } = await renderScreen();
    for (const card of el.querySelectorAll(".ui-card")) {
      expect(card.querySelectorAll(".ui-btn--primary").length).toBeLessThanOrEqual(1);
    }
    expect(el.querySelectorAll(".ui-card")).toHaveLength(2);
  });
});
