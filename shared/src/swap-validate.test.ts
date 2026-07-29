import { describe, it, expect } from "vitest";
import { validateSwap } from "./swap";
import type { Shift } from "./types";
import type { EntryCategory } from "./category";

type TestShift = Shift & { category: EntryCategory };

const shift = (over: Partial<TestShift>): TestShift => ({
  id: 0, date: "2026-07-10", start: "09:00", end: "18:00",
  templateId: null, title: null, employeeId: null, note: null, category: "shift", ...over,
});

const now = { date: "2026-07-01", time: "12:00" };

describe("validateSwap", () => {
  const from = shift({ id: 1, date: "2026-07-10", employeeId: 100 });
  const to = shift({ id: 2, date: "2026-07-11", employeeId: 200 });

  it("accepts a clean swap", () => {
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: true });
  });

  it("rejects when the shift is no longer owned by the initiator", () => {
    const r = validateSwap({
      fromShift: { ...from, employeeId: 999 }, toShift: to,
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "from-shift-not-owned" });
  });

  it("rejects a swap of a past shift", () => {
    const r = validateSwap({
      fromShift: { ...from, date: "2026-06-01" }, toShift: to,
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "from-shift-in-past" });
  });

  it("rejects when the initiator would be double-booked", () => {
    // initiator (100) already has a shift on 2026-07-11 that overlaps `to`
    const clash = shift({ id: 3, date: "2026-07-11", start: "10:00", end: "16:00", employeeId: 100 });
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [clash], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "double-booking-from" });
  });

  it("rejects when the shift is no longer owned by the counterparty", () => {
    const r = validateSwap({
      fromShift: from, toShift: { ...to, employeeId: 999 },
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "to-shift-not-owned" });
  });

  it("rejects a swap where the counterparty's shift is in the past", () => {
    const r = validateSwap({
      fromShift: from, toShift: { ...to, date: "2026-06-01" },
      fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [], now,
    });
    expect(r).toEqual({ ok: false, reason: "to-shift-in-past" });
  });

  it("rejects when the counterparty would be double-booked", () => {
    // counterparty (200) already has a shift on 2026-07-10 that overlaps `from`
    const clash = shift({ id: 4, date: "2026-07-10", start: "10:00", end: "16:00", employeeId: 200 });
    const r = validateSwap({
      fromShift: from, toShift: to, fromEmployeeId: 100, toEmployeeId: 200,
      fromOtherShifts: [], toOtherShifts: [clash], now,
    });
    expect(r).toEqual({ ok: false, reason: "double-booking-to" });
  });

  describe("identical-shift guard", () => {
    // Two people both work «Утро 5 августа» — swapping changes nothing.
    it("rejects the same preset on the same day", () => {
      const morningA = shift({ id: 1, date: "2026-08-05", employeeId: 100, templateId: 7, start: "08:00", end: "17:00" });
      const morningB = shift({ id: 2, date: "2026-08-05", employeeId: 200, templateId: 7, start: "08:00", end: "17:00" });
      const r = validateSwap({
        fromShift: morningA, toShift: morningB, fromEmployeeId: 100, toEmployeeId: 200,
        fromOtherShifts: [], toOtherShifts: [], now,
      });
      expect(r).toEqual({ ok: false, reason: "identical-shift" });
    });

    // «Утро 5 августа» ↔ «Утро 12 августа» — trading which day you work is the
    // whole point of a swap; the same preset on a different day must stay allowed.
    it("allows the same preset swapped across different days", () => {
      const augFive = shift({ id: 1, date: "2026-08-05", employeeId: 100, templateId: 7 });
      const augTwelve = shift({ id: 2, date: "2026-08-12", employeeId: 200, templateId: 7 });
      const r = validateSwap({
        fromShift: augFive, toShift: augTwelve, fromEmployeeId: 100, toEmployeeId: 200,
        fromOtherShifts: [], toOtherShifts: [], now,
      });
      expect(r).toEqual({ ok: true });
    });

    // «Утро» ↔ «Ночь» on the same day changes both people's hours — allowed.
    it("allows two different presets on the same day", () => {
      const morning = shift({ id: 1, date: "2026-08-05", employeeId: 100, templateId: 7, start: "08:00", end: "17:00" });
      const night = shift({ id: 2, date: "2026-08-05", employeeId: 200, templateId: 9, start: "20:00", end: "23:59" });
      const r = validateSwap({
        fromShift: morning, toShift: night, fromEmployeeId: 100, toEmployeeId: 200,
        fromOtherShifts: [], toOtherShifts: [], now,
      });
      expect(r).toEqual({ ok: true });
    });

    // No preset on either side: fall back to category + start + end.
    it("compares preset-less shifts by category, start and end", () => {
      const handMade = shift({ id: 1, date: "2026-08-05", employeeId: 100, templateId: null, category: "shift", start: "09:00", end: "18:00" });
      const sameKind = shift({ id: 2, date: "2026-08-05", employeeId: 200, templateId: null, category: "shift", start: "09:00", end: "18:00" });
      const rejected = validateSwap({
        fromShift: handMade, toShift: sameKind, fromEmployeeId: 100, toEmployeeId: 200,
        fromOtherShifts: [], toOtherShifts: [], now,
      });
      expect(rejected).toEqual({ ok: false, reason: "identical-shift" });

      const differentTime = shift({ id: 3, date: "2026-08-05", employeeId: 200, templateId: null, category: "shift", start: "10:00", end: "19:00" });
      const allowed = validateSwap({
        fromShift: handMade, toShift: differentTime, fromEmployeeId: 100, toEmployeeId: 200,
        fromOtherShifts: [], toOtherShifts: [], now,
      });
      expect(allowed).toEqual({ ok: true });
    });
  });
});
