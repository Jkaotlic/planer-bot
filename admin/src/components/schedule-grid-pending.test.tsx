// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { EMPTY_CALENDAR } from "@planer/shared";
import { ScheduleGrid } from "./ScheduleGrid";
import type { Employee, Shift } from "../api/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEEK = ["2026-06-08", "2026-06-09", "2026-06-10", "2026-06-11", "2026-06-12", "2026-06-13", "2026-06-14"];

const employee: Employee = {
  id: 1, displayName: "Иванов Иван", isAdmin: false, isActive: true, telegramUserId: null,
  birthDate: null, preferredName: null, address: "Иван",
  excludedFromAssignment: false, excludedFromSwaps: false,
  isObserver: false, selfScheduleEnabled: false, remindersEnabled: true,
};

const sick = (patch: Partial<Shift> = {}): Shift => ({
  id: 3, date: WEEK[1]!, start: null, end: null, endDate: null, category: "sick_leave", title: null,
  location: null, unrecognisedCode: null, templateId: null, employeeId: 1, ...patch,
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function render(shifts: Shift[]) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      createElement(ScheduleGrid, {
        calendar: EMPTY_CALENDAR, employees: [employee], shifts, templates: [], weekDates: WEEK,
        onAddClick: () => {}, onEntryClick: () => {},
      }),
    );
  });
  return host;
}

describe("сетка и больничный, ждущий ОК", () => {
  it("бледный чип в пунктире с «ждёт ОК», и под сеткой строка-объяснение", async () => {
    const el = await render([sick({ pending: true })]);
    const chip = el.querySelector<HTMLElement>(".entry-chip.is-pending")!;
    expect(chip.textContent).toContain("Больничный · ждёт ОК");
    expect(chip.style.background).toBe("rgb(255, 227, 227)");
    expect(chip.style.outline).toContain("dashed");
    expect(el.querySelector(".grid-pending-legend")?.textContent).toContain("Больничный (ждёт ОК)");
  });

  it("без ждущих строки-объяснения нет, а подтверждённый чип обычный", async () => {
    const el = await render([sick()]);
    expect(el.querySelector(".grid-pending-legend")).toBeNull();
    const chip = el.querySelector<HTMLElement>(".entry-chip")!;
    expect(chip.classList.contains("is-pending")).toBe(false);
    expect(chip.textContent).not.toContain("ждёт ОК");
    expect(chip.style.background).not.toBe("rgb(255, 227, 227)");
  });

  it("продление: дни внутри подтверждённого срока обычные, только новые — бледные", async () => {
    const el = await render([
      sick({ date: WEEK[1]!, endDate: WEEK[3]!, pending: true, approvedSpan: { date: WEEK[1]!, endDate: WEEK[2]! } }),
    ]);
    const chips = [...el.querySelectorAll<HTMLElement>(".entry-chip")];
    expect(chips).toHaveLength(3);
    expect(chips.map((c) => c.classList.contains("is-pending"))).toEqual([false, false, true]);
    expect(el.querySelector(".grid-pending-legend")).not.toBeNull();
  });

  it("продление целиком внутри показанной недели, но все дни подтверждены, — строки нет", async () => {
    const el = await render([
      sick({ date: WEEK[1]!, endDate: WEEK[2]!, pending: true, approvedSpan: { date: WEEK[1]!, endDate: WEEK[3]! } }),
    ]);
    expect(el.querySelector(".grid-pending-legend")).toBeNull();
  });
});
