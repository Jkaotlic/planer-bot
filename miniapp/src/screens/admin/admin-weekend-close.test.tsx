// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type AdminSlotView } from "../../api/client";
import { AdminWeekendScreen } from "./AdminWeekendScreen";

/**
 * «Набрали, закрыть»: набранный выходной оставался открытым до своей даты, и
 * «Хочу» у всей команды было живым. Проверяется проводка — кнопка спрашивает,
 * прежде чем закрыть, зовёт сервер с id именно этого слота и говорит, скольким
 * ушёл отбой; закрытый слот не предлагает «Назначить».
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

async function settle(times = 8) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
  }
}

const view = (id: number, status: AdminSlotView["slot"]["status"], over: Partial<AdminSlotView> = {}): AdminSlotView => ({
  slot: { id, date: "2026-10-03", start: "10:00", end: "18:00", title: `Ярмарка ${id}`, location: null, note: null, status },
  interested: [
    { employeeId: 3, name: "Марк", confirmedThisMonth: 0, passedOver: 0, absence: null },
    { employeeId: 4, name: "Аня", confirmedThisMonth: 1, passedOver: 0, absence: null },
  ],
  assignees: [],
  ...over,
});

async function mount(slots: AdminSlotView[]) {
  vi.spyOn(apiClient, "getAdminWeekendSlots").mockResolvedValue(slots);
  vi.spyOn(apiClient, "getPayroll").mockResolvedValue([]);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(AppRoot, null, createElement(AdminWeekendScreen, { today: "2026-09-28" })));
  });
  await settle();
  return host;
}

const buttons = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].filter((b) => b.textContent?.trim() === text);

async function click(b: HTMLElement) {
  await act(async () => { b.click(); });
  await settle();
}

describe("AdminWeekendScreen — «Набрали, закрыть»", () => {
  it("одно нажатие только спрашивает; подтверждение закрывает этот слот и говорит, скольким написали", async () => {
    const close = vi.spyOn(apiClient, "closeSlot").mockResolvedValue({ toldOff: 2 });
    const el = await mount([view(301, "open"), view(302, "open")]);

    const [, second] = buttons(el, "Набрали, закрыть");
    await click(second!);
    expect(close).not.toHaveBeenCalled();
    expect(el.textContent).toContain("Закрыть смену? Назначенные выходят");

    await click(buttons(el, "Закрыть")[0]!);
    expect(close).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledWith(302);
    expect(el.textContent).toContain("Закрыто. Написали желающим: 2");
  });

  it("закрытый слот: пометка и назначенные, но ни «Назначить», ни «Набрали, закрыть»", async () => {
    const el = await mount([
      view(303, "closed", { assignees: [{ assignmentId: 9, employeeId: 5, name: "Игорь", status: "confirmed" }] }),
    ]);
    expect(el.textContent).toContain("Закрыта — набрали");
    expect(el.textContent).toContain("Игорь");
    expect(buttons(el, "Назначить")).toHaveLength(0);
    expect(buttons(el, "Набрали, закрыть")).toHaveLength(0);
  });
});

describe("AdminWeekendScreen — отметка об отсутствии", () => {
  it("«Отпуск» у желающего — цветная пилюля категории, а не серая пилюля статуса", async () => {
    const el = await mount([
      view(304, "open", {
        interested: [{ employeeId: 3, name: "Марк", confirmedThisMonth: 0, passedOver: 0, absence: "vacation" }],
      }),
    ]);
    const label = [...el.querySelectorAll<HTMLElement>("*")].find((n) => n.children.length === 0 && n.textContent === "Отпуск");
    expect(label).toBeTruthy();
    expect(label!.closest(".ui-pill")).toBeNull();
  });
});
