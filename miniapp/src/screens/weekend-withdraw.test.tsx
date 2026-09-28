// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { WeekendScreen } from "./WeekendScreen";
import type { WeekendOffer, WeekendSlotView } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const view = (interested: boolean): WeekendSlotView => ({
  slot: { id: 7, date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка", location: null, note: null, status: "open" },
  interested,
  assignees: [],
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null; host = null;
});

async function mount(interested: boolean, onWithdraw = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AppRoot>
        <WeekendScreen
          slots={[view(interested)]} offers={[]}
          busySlotIds={new Set()} busyOfferIds={new Set()}
          slotErrors={new Map()} offerErrors={new Map()}
          onInterest={vi.fn()} onWithdrawInterest={onWithdraw} onConfirm={vi.fn()} onDecline={vi.fn()}
        />
      </AppRoot>,
    );
  });
  return host;
}

describe("«Передумал» на выходной смене", () => {
  // «🙋 Хочу» нельзя было отозвать: передумавший оставался в списке желающих.
  it("у откликнувшегося есть «Передумал», и оно снимает отклик", async () => {
    const onWithdraw = vi.fn();
    const el = await mount(true, onWithdraw);
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.includes("Передумал"));
    expect(btn).toBeDefined();
    await act(async () => btn!.click());
    expect(onWithdraw).toHaveBeenCalledWith(7);
  });

  it("у не откликнувшегося «Передумал» нет", async () => {
    const el = await mount(false);
    expect(el.textContent).not.toContain("Передумал");
  });
});

const OFFER: WeekendOffer = {
  assignment: { id: 42, status: "offered", hours: 8 },
  slot: { id: 7, date: "2099-01-03", start: "10:00", end: "18:00", title: "Ярмарка", location: null, note: null, status: "open" },
};

async function mountOffer(onDecline = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AppRoot>
        <WeekendScreen
          slots={[]} offers={[OFFER]}
          busySlotIds={new Set()} busyOfferIds={new Set()}
          slotErrors={new Map()} offerErrors={new Map()}
          onInterest={vi.fn()} onWithdrawInterest={vi.fn()} onConfirm={vi.fn()} onDecline={onDecline}
        />
      </AppRoot>,
    );
  });
  return host;
}

describe("«Не смогу» на предложенной смене — необратимое действие спрашивает", () => {
  // Прямая кнопка срабатывала бы с одного тапа, а «Не смогу» отменяет назначение
  // без возврата — админу приходится звать другого человека.
  it("одно нажатие не отказывается от смены, а сперва спрашивает", async () => {
    const onDecline = vi.fn();
    const el = await mountOffer(onDecline);
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Не смогу");
    expect(btn).toBeDefined();

    await act(async () => btn!.click());

    expect(onDecline).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Отказаться от этой смены?");
  });
});
