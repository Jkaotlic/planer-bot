import { describe, expect, it } from "vitest";
import { diffSchedules } from "./schedule-diff";
import type { Shift } from "../db/schema";

const entry = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    employeeId: 1,
    date: "2026-09-01",
    endDate: null,
    start: "08:00",
    end: "17:00",
    category: "shift",
    title: "Утро",
    templateId: 1,
    note: null,
    location: null,
    unrecognisedCode: null,
    ...over,
  }) as Shift;

describe("diffSchedules", () => {
  it("новая запись — added у её владельца", () => {
    const d = diffSchedules([], [entry({ id: 1 })]);
    expect(d.get(1)!.added.map((s) => s.id)).toEqual([1]);
    expect(d.get(1)!.removed).toEqual([]);
    expect(d.get(1)!.changed).toEqual([]);
  });

  it("исчезнувшая запись — removed", () => {
    const d = diffSchedules([entry({ id: 1 })], []);
    expect(d.get(1)!.removed.map((s) => s.id)).toEqual([1]);
  });

  it("сдвинутое время — changed, и только он", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, start: "15:00", end: "23:00" })]);
    expect(d.get(1)!.changed).toHaveLength(1);
    expect(d.get(1)!.changed[0]!.before.start).toBe("08:00");
    expect(d.get(1)!.changed[0]!.after.start).toBe("15:00");
    expect(d.get(1)!.added).toEqual([]);
    expect(d.get(1)!.removed).toEqual([]);
  });

  it("сдвинутая дата — changed", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, date: "2026-09-04" })]);
    expect(d.get(1)!.changed).toHaveLength(1);
  });

  it("смена вида записи — changed", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, category: "vacation", start: null, end: null })]);
    expect(d.get(1)!.changed).toHaveLength(1);
  });

  it("правка заметки изменением не считается", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, note: "привёз ключи" })]);
    expect(d.size).toBe(0);
  });

  it("правка подписи и пресета изменением не считается", () => {
    const d = diffSchedules([entry({ id: 1 })], [entry({ id: 1, title: "Дежурство", templateId: 4 })]);
    expect(d.size).toBe(0);
  });

  it("смена владельца — снято прежнему, поставлено новому", () => {
    const d = diffSchedules([entry({ id: 1, employeeId: 1 })], [entry({ id: 1, employeeId: 2 })]);
    expect(d.get(1)!.removed.map((s) => s.id)).toEqual([1]);
    expect(d.get(1)!.added).toEqual([]);
    expect(d.get(2)!.added.map((s) => s.id)).toEqual([1]);
    expect(d.get(2)!.changed).toEqual([]);
  });

  it("вакантная запись ничья — в дифе её нет", () => {
    expect(diffSchedules([], [entry({ id: 1, employeeId: null })]).size).toBe(0);
    expect(diffSchedules([entry({ id: 1, employeeId: null })], []).size).toBe(0);
  });

  it("запись, отданную никому, прежний владелец теряет", () => {
    const d = diffSchedules([entry({ id: 1, employeeId: 1 })], [entry({ id: 1, employeeId: null })]);
    expect(d.get(1)!.removed.map((s) => s.id)).toEqual([1]);
    expect(d.size).toBe(1);
  });

  it("человек без единого изменения в диф не попадает", () => {
    expect(diffSchedules([entry({ id: 1 })], [entry({ id: 1 })]).size).toBe(0);
  });

  it("считает по людям, а не в кучу", () => {
    const d = diffSchedules(
      [entry({ id: 1, employeeId: 1 }), entry({ id: 2, employeeId: 2 })],
      [entry({ id: 1, employeeId: 1, date: "2026-09-05" }), entry({ id: 3, employeeId: 2 })],
    );
    expect(d.get(1)!.changed).toHaveLength(1);
    expect(d.get(2)!.removed.map((s) => s.id)).toEqual([2]);
    expect(d.get(2)!.added.map((s) => s.id)).toEqual([3]);
  });
});
