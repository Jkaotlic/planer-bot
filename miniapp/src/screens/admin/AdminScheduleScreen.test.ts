import { describe, expect, it } from "vitest";
import { showsWeekSwitcher, distributeNotice, nextPickByKind, balanceKindOf, type KindRoles } from "./AdminScheduleScreen";

const load = (employeeId: number, byKind: Record<string, number>, total = Object.values(byKind).reduce((a, b) => a + b, 0)) => ({
  employeeId,
  byKind,
  total,
});
const roles = (map: Record<string, Partial<KindRoles>>): Map<string, KindRoles> =>
  new Map(Object.entries(map).map(([kind, r]) => [kind, { pool: r.pool ?? [], preference: r.preference ?? {} }]));

/**
 * MIRRORS `admin/src/components/balance-rail.test.ts` — the same ★ appears in the
 * console's balance rail and in «Заполнить неделю» here, and both must rank the way
 * the server does. Change one, change the other.
 */
describe("nextPickByKind", () => {
  it("picks whoever holds fewest of that kind, then fewest overall, then lowest id", () => {
    const loads = [load(1, { "Ночь": 2 }), load(2, { "Ночь": 1 }), load(3, { "Ночь": 1, "Утро": 5 })];
    expect(nextPickByKind(loads, ["Ночь"], roles({})).get("Ночь")).toBe(2);
  });

  it("never stars somebody outside the pool, however few of the kind they hold", () => {
    const loads = [load(1, {}), load(2, { "Дежурство · Поклонка": 1 }), load(3, { "Дежурство · Поклонка": 2 })];
    const only23 = roles({ "Дежурство · Поклонка": { pool: [2, 3] } });
    expect(nextPickByKind(loads, ["Дежурство · Поклонка"], only23).get("Дежурство · Поклонка")).toBe(2);
  });

  it("treats an empty pool as everyone — an unconfigured preset excludes nobody", () => {
    const loads = [load(1, {}), load(2, { "Утро": 1 })];
    expect(nextPickByKind(loads, ["Утро"], roles({ "Утро": { pool: [] } })).get("Утро")).toBe(1);
  });

  it("leaves a kind unstarred when nobody active is in its pool", () => {
    const loads = [load(1, {}), load(2, {})];
    const ghostPool = roles({ "Дежурство · Телефон": { pool: [99] } });
    expect(nextPickByKind(loads, ["Дежурство · Телефон"], ghostPool).has("Дежурство · Телефон")).toBe(false);
  });

  it("breaks a tie on the kind by who asked for it", () => {
    const loads = [load(1, { "Вечер": 1 }), load(2, { "Вечер": 1 })];
    expect(nextPickByKind(loads, ["Вечер"], roles({ "Вечер": { preference: { 2: 3 } } })).get("Вечер")).toBe(2);
  });

  it("keeps a preference below the per-kind count — asking does not jump the queue", () => {
    const loads = [load(1, { "Вечер": 0 }), load(2, { "Вечер": 1 })];
    expect(nextPickByKind(loads, ["Вечер"], roles({ "Вечер": { preference: { 2: 9 } } })).get("Вечер")).toBe(1);
  });

  it("keeps a preference above the overall total, where the server puts it", () => {
    const loads = [load(1, { "Вечер": 1 }), load(2, { "Вечер": 1, "Утро": 4 })];
    expect(nextPickByKind(loads, ["Вечер"], roles({ "Вечер": { preference: { 2: 1 } } })).get("Вечер")).toBe(2);
  });

  it("ignores a preference from somebody the pool excludes", () => {
    const loads = [load(1, {}), load(2, {})];
    const wanted = roles({ "Утро": { pool: [1], preference: { 2: 9 } } });
    expect(nextPickByKind(loads, ["Утро"], wanted).get("Утро")).toBe(1);
  });

  it("has no roles for a kind that is not a preset (a one-off time), so everyone counts", () => {
    const loads = [load(1, { "Своё время": 1 }), load(2, {})];
    expect(nextPickByKind(loads, ["Своё время"], roles({ "Утро": { pool: [1] } })).get("Своё время")).toBe(2);
  });
});

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

/**
 * Mirror of `balanceKindOf` in admin/src/components/BalanceRail.tsx — the reading
 * half of the ★. Duplicated by hand, as the Mini App duplicates everything it does
 * not take from shared, so it needs its own test to catch the drift.
 */
describe("balanceKindOf", () => {
  const nameById = new Map([[1, "Утро"]]);
  const entry = (over: Partial<Parameters<typeof balanceKindOf>[0]>) => ({
    category: "shift" as const, start: "09:00", end: "18:00",
    templateId: null, title: null, unrecognisedCode: null, ...over,
  });

  it("names an entry by the preset it came from", () => {
    expect(balanceKindOf(entry({ templateId: 1 }), nameById)).toBe("Утро");
  });

  it("falls back to the title, then to the custom-time bucket", () => {
    expect(balanceKindOf(entry({ title: "День" }), nameById)).toBe("День");
    expect(balanceKindOf(entry({}), nameById)).toBe("Своё время");
  });

  it("files an unread cell under its own bucket even when it has times and a name", () => {
    expect(balanceKindOf(entry({ title: "День", unrecognisedCode: "Ко" }), nameById)).toBe("Не распознано (?)");
  });

  it("counts an unread cell that has no times at all", () => {
    expect(balanceKindOf(entry({ start: null, end: null, unrecognisedCode: "Ко" }), nameById))
      .toBe("Не распознано (?)");
  });

  it("counts nothing for an absence, or for an ordinary entry with no times", () => {
    expect(balanceKindOf(entry({ category: "vacation", start: null, end: null }), nameById)).toBeNull();
    expect(balanceKindOf(entry({ start: null, end: null }), nameById)).toBeNull();
  });
});
