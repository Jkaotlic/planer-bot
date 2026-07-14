import { describe, it, expect } from "vitest";
import { lateWeight, distributeFairly, type FillSlot, type WorkerLoad } from "./distribute";

const slot = (id: number, date: string, start: string, end: string): FillSlot => ({ id, date, start, end });
const idleWorker = (employeeId: number): WorkerLoad => ({ employeeId, lateScore: 0, hours: 0, busy: [] });

describe("lateWeight", () => {
  it("weighs a night shift (15:00-23:00) as 2", () => {
    expect(lateWeight({ start: "15:00", end: "23:00" })).toBe(2);
  });

  it("weighs an overnight shift (23:00-07:00) as 2", () => {
    expect(lateWeight({ start: "23:00", end: "07:00" })).toBe(2);
  });

  it("weighs an evening shift (12:00-20:00) as 1", () => {
    expect(lateWeight({ start: "12:00", end: "20:00" })).toBe(1);
  });

  it("weighs a day shift (08:00-17:00) as 0", () => {
    expect(lateWeight({ start: "08:00", end: "17:00" })).toBe(0);
  });
});

describe("distributeFairly", () => {
  it("spreads night slots fairly across idle workers (nobody gets all)", () => {
    const slots = [
      slot(1, "2026-07-01", "23:00", "07:00"),
      slot(2, "2026-07-02", "23:00", "07:00"),
      slot(3, "2026-07-03", "23:00", "07:00"),
      slot(4, "2026-07-04", "23:00", "07:00"),
    ];
    const workers = [idleWorker(1), idleWorker(2), idleWorker(3)];
    const assignments = distributeFairly(slots, workers);
    expect(assignments).toHaveLength(4);

    const counts = new Map<number, number>();
    for (const a of assignments) counts.set(a.employeeId, (counts.get(a.employeeId) ?? 0) + 1);
    const values = [...counts.values()];
    // spread like 2/1/1, not 4/0/0
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    expect(values.every((v) => v < 4)).toBe(true);
    expect(counts.size).toBeGreaterThan(1);
  });

  it("gives a pre-loaded worker fewer new late slots than idle peers", () => {
    const slots = [
      slot(1, "2026-07-01", "23:00", "07:00"),
      slot(2, "2026-07-02", "23:00", "07:00"),
      slot(3, "2026-07-03", "23:00", "07:00"),
    ];
    const workers = [
      { employeeId: 1, lateScore: 10, hours: 0, busy: [] },
      idleWorker(2),
      idleWorker(3),
    ];
    const assignments = distributeFairly(slots, workers);
    const countFor = (id: number) => assignments.filter((a) => a.employeeId === id).length;
    expect(countFor(1)).toBeLessThan(countFor(2));
    expect(countFor(1)).toBeLessThan(countFor(3));
  });

  it("does not assign a slot to a worker whose busy overlaps it", () => {
    const slots = [slot(1, "2026-07-01", "09:00", "17:00")];
    const workers = [
      { employeeId: 1, lateScore: 0, hours: 0, busy: [{ date: "2026-07-01", start: "08:00", end: "18:00" }] },
      idleWorker(2),
    ];
    const assignments = distributeFairly(slots, workers);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.employeeId).toBe(2);
  });

  it("leaves a slot unassigned when more slots than free workers overlap the same time", () => {
    const slots = [
      slot(1, "2026-07-01", "09:00", "17:00"),
      slot(2, "2026-07-01", "10:00", "18:00"),
      slot(3, "2026-07-01", "11:00", "19:00"),
    ];
    const workers = [idleWorker(1), idleWorker(2)];
    const assignments = distributeFairly(slots, workers);
    expect(assignments.length).toBeLessThan(slots.length);
    expect(assignments).toHaveLength(2);
  });
});
