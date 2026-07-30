import { describe, expect, it } from "vitest";
import { nextPickByKind, type KindRoles } from "./BalanceRail";

const load = (employeeId: number, byKind: Record<string, number>, total = Object.values(byKind).reduce((a, b) => a + b, 0)) => ({
  employeeId,
  byKind,
  total,
});
const roles = (map: Record<string, Partial<KindRoles>>): Map<string, KindRoles> =>
  new Map(Object.entries(map).map(([kind, r]) => [kind, { pool: r.pool ?? [], preference: r.preference ?? {} }]));

/**
 * The ★ tells the admin who «Распределить честно» will hand the next shift of a kind
 * to. It is believed, so it has to rank by the server's rule and not an approximation
 * of it: pool first as a hard filter, then fewest of the kind, then who asked for it,
 * then fewest overall, then id.
 */
describe("nextPickByKind", () => {
  it("picks whoever holds fewest of that kind, then fewest overall, then lowest id", () => {
    const loads = [load(1, { "Ночь": 2 }), load(2, { "Ночь": 1 }), load(3, { "Ночь": 1, "Утро": 5 })];
    expect(nextPickByKind(loads, ["Ночь"], roles({})).get("Ночь")).toBe(2);
  });

  // The case that made this a finding: the rail counted the whole team, so the person
  // with the fewest duties won the ★ even when they may not take that duty at all —
  // and then the button handed it to somebody else.
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
    const wanted = roles({ "Вечер": { preference: { 2: 3 } } });
    expect(nextPickByKind(loads, ["Вечер"], wanted).get("Вечер")).toBe(2);
  });

  it("keeps a preference below the per-kind count — asking does not jump the queue", () => {
    const loads = [load(1, { "Вечер": 0 }), load(2, { "Вечер": 1 })];
    const wanted = roles({ "Вечер": { preference: { 2: 9 } } });
    expect(nextPickByKind(loads, ["Вечер"], wanted).get("Вечер")).toBe(1);
  });

  it("keeps a preference above the overall total, where the server puts it", () => {
    // 1 holds fewer shifts overall, both are level on «Вечер», and 2 asked for it.
    const loads = [load(1, { "Вечер": 1 }), load(2, { "Вечер": 1, "Утро": 4 })];
    const wanted = roles({ "Вечер": { preference: { 2: 1 } } });
    expect(nextPickByKind(loads, ["Вечер"], wanted).get("Вечер")).toBe(2);
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
