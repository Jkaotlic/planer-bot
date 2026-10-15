// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import { apiClient, type Me, type Shift } from "../api/client";
import { App } from "../App";
import { monthStartOf } from "./SelfEntryScreen";

/**
 * Связка целиком: владелец-админ открывает «Записать себе», видит свой идущий
 * отпуск и кончившийся на днях больничный, сокращает отпуск до одного дня — и
 * запрос уходит админской ручкой с `endDate: null` и его же `employeeId`.
 * Экран проверен отдельно (`self-entry-admin.test.tsx`), но это ничего не
 * говорит про то, передаёт ли App ему ручки, `id` и прошедшие записи.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function daysFromNow(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

const TODAY = daysFromNow(0);
const ME_ID = 1;

const ME: Me = {
  id: ME_ID, displayName: "Марк Волков", address: "Марк", preferredName: null, isAdmin: true,
  remindersEnabled: true, swapsLocked: false, excludedFromSwaps: false, isObserver: false,
  selfScheduleEnabled: false, startTab: null, canAnnounce: false,
};

const VACATION = {
  id: 9001, date: daysFromNow(-3), endDate: daysFromNow(2), start: null, end: null,
  category: "vacation", title: null, templateId: null, employeeId: ME_ID, location: null, unrecognisedCode: null,
} as unknown as Shift;

const ENDED_SICK = {
  id: 9002, date: daysFromNow(-1), endDate: null, start: null, end: null,
  category: "sick_leave", title: null, templateId: null, employeeId: ME_ID, location: null, unrecognisedCode: null,
} as unknown as Shift;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  window.history.replaceState({}, "", "/");
  vi.restoreAllMocks();
});

async function settle(times = 30) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
  }
}

async function setInput(field: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const buttons = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll("button")].filter((b) => (b.textContent ?? "").trim() === text);

describe("админ правит себе отпуск из «Записать себе»", () => {
  it("видит отпуск и прошедшее, сокращение до дня уходит в updateEntry с endDate: null", async () => {
    vi.spyOn(apiClient, "getMe").mockResolvedValue(ME);
    vi.spyOn(apiClient, "getMyShifts").mockResolvedValue({ shifts: [VACATION], today: TODAY });
    const schedule = vi.spyOn(apiClient, "getTeamSchedule").mockResolvedValue({ employees: [], shifts: [ENDED_SICK, VACATION], calendar: [] });
    vi.spyOn(apiClient, "getSwaps").mockResolvedValue([]);
    vi.spyOn(apiClient, "getWeekendSlots").mockResolvedValue([]);
    vi.spyOn(apiClient, "getWeekendOffers").mockResolvedValue([]);
    const update = vi.spyOn(apiClient, "updateEntry").mockResolvedValue({ entry: VACATION, notified: { delivered: 0, intended: 0 } } as never);
    const updateSelf = vi.spyOn(apiClient, "updateSelfEntry");

    window.history.replaceState({}, "", "/?screen=sick");
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root!.render(createElement(AppRoot, null, createElement(App))));
    await settle();

    expect(schedule).toHaveBeenCalledWith(monthStartOf(TODAY), TODAY);
    expect(buttons(host, "Изменить")).toHaveLength(2);

    // Список по дате начала: отпуск начался раньше больничного — он первый.
    await act(async () => buttons(host!, "Изменить")[0]!.click());
    const to = [...host.querySelectorAll<HTMLInputElement>('input[type="date"]')].find((i) => i.value === VACATION.endDate)!;
    await setInput(to, VACATION.date);
    await act(async () => buttons(host!, "Сохранить")[0]!.click());
    await settle(5);

    expect(updateSelf).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(9001, { category: "vacation", date: VACATION.date, endDate: null, employeeId: ME_ID });
  });
});
