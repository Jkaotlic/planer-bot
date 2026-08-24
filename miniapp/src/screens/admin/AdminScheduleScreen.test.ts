import { describe, expect, it } from "vitest";
import { showsWeekSwitcher } from "./AdminScheduleScreen";

const CLOSED = { csvOpen: false, kindsOpen: false, settingsOpen: false, fillOpen: false, editing: null };

describe("showsWeekSwitcher", () => {
  it("shows the switcher when every sub-flow is closed", () => {
    expect(showsWeekSwitcher(CLOSED)).toBe(true);
  });

  it("hides it while the CSV import/export flow is open", () => {
    expect(showsWeekSwitcher({ ...CLOSED, csvOpen: true })).toBe(false);
  });

  it("hides it while the «кто что может» editor is open", () => {
    expect(showsWeekSwitcher({ ...CLOSED, kindsOpen: true })).toBe(false);
  });

  it("прячет переключатель недели, пока открыты «Виды смен»", () => {
    expect(showsWeekSwitcher({ ...CLOSED, settingsOpen: true })).toBe(false);
  });

  it("hides it while «Заполнить неделю» is open — its per-day choices are keyed off the visible week", () => {
    expect(showsWeekSwitcher({ ...CLOSED, fillOpen: true })).toBe(false);
  });

  it("hides it while the entry form is open, whether adding or editing", () => {
    expect(showsWeekSwitcher({ ...CLOSED, editing: "new" })).toBe(false);
    expect(showsWeekSwitcher({ ...CLOSED, editing: { id: 1 } })).toBe(false);
  });

  it("shows it again once every sub-flow has closed", () => {
    const allOpen = { csvOpen: true, kindsOpen: true, settingsOpen: true, fillOpen: true, editing: "new" as const };
    expect(showsWeekSwitcher(allOpen)).toBe(false);
    expect(showsWeekSwitcher({ ...allOpen, csvOpen: false, kindsOpen: false, settingsOpen: false, fillOpen: false, editing: null })).toBe(true);
  });
});
