import { describe, it, expect } from "vitest";
import { validateSwap } from "./swap";
import type { Shift } from "./types";

const shift = (over: Partial<Shift>): Shift => ({
  id: 0, date: "2026-07-10", start: "09:00", end: "18:00",
  templateId: null, title: null, employeeId: null, note: null, ...over,
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
});
