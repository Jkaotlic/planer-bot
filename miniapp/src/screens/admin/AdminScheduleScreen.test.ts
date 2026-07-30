import { describe, expect, it } from "vitest";
import { showsWeekSwitcher, distributeNotice } from "./AdminScheduleScreen";

describe("distributeNotice", () => {
  it("says nothing was free when there was nothing to do", () => {
    expect(distributeNotice(0, [])).toBe("Все смены уже распределены — свободных не было.");
  });

  it("counts what it handed out", () => {
    expect(distributeNotice(3, [])).toBe("Распределено смен: 3.");
  });

  // «Распределено смен: 3» over five empty cells used to be the only thing the admin
  // saw — the two it walked past left no trace at all.
  it("owns up to the slots it walked past because everybody was away", () => {
    expect(distributeNotice(3, [{ kind: "Утро", reason: "nobody_free" }, { kind: "Ночь", reason: "nobody_free" }]))
      .toBe("Распределено смен: 3. Не удалось: 2 — все, кто может, заняты или в отпуске.");
  });

  // A pool that lists only archived people is a broken setting, not a busy week, and
  // the fix lives on another screen — so it gets named.
  it("names the kinds whose pool has nobody active left, and where to fix it", () => {
    expect(distributeNotice(1, [{ kind: "Дежурство · Телефон", reason: "empty_pool" }]))
      .toBe(
        "Распределено смен: 1. Не удалось: 1. " +
          "У «Дежурство · Телефон» в пуле не осталось активных людей — проверь «кто что может».",
      );
  });

  it("does not claim a success when it placed nobody at all", () => {
    expect(distributeNotice(0, [{ kind: "Утро", reason: "nobody_free" }]))
      .toBe("Не распределено ни одной смены. Не удалось: 1 — все, кто может, заняты или в отпуске.");
  });

  it("lists each broken pool once, however many of its slots were skipped", () => {
    expect(distributeNotice(0, [
      { kind: "Утро", reason: "empty_pool" },
      { kind: "Утро", reason: "empty_pool" },
      { kind: "Ночь", reason: "nobody_free" },
    ])).toBe(
      "Не распределено ни одной смены. Не удалось: 3. " +
        "У «Утро» в пуле не осталось активных людей — проверь «кто что может».",
    );
  });
});

const CLOSED = { csvOpen: false, kindsOpen: false, fillOpen: false, editing: null };

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

  it("hides it while «Заполнить неделю» is open — its per-day choices are keyed off the visible week", () => {
    expect(showsWeekSwitcher({ ...CLOSED, fillOpen: true })).toBe(false);
  });

  it("hides it while the entry form is open, whether adding or editing", () => {
    expect(showsWeekSwitcher({ ...CLOSED, editing: "new" })).toBe(false);
    expect(showsWeekSwitcher({ ...CLOSED, editing: { id: 1 } })).toBe(false);
  });

  it("shows it again once every sub-flow has closed", () => {
    const allOpen = { csvOpen: true, kindsOpen: true, fillOpen: true, editing: "new" as const };
    expect(showsWeekSwitcher(allOpen)).toBe(false);
    expect(showsWeekSwitcher({ ...allOpen, csvOpen: false, kindsOpen: false, fillOpen: false, editing: null })).toBe(true);
  });
});
