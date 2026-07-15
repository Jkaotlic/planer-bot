import { describe, it, expect } from "vitest";
import { lateWeight, distributeFairly, type FillSlot, type WorkerLoad } from "./distribute";

const slot = (id: number, date: string, start: string, end: string, kind = "Ночь"): FillSlot => ({
  id,
  date,
  start,
  end,
  kind,
});
const idleWorker = (employeeId: number): WorkerLoad => ({
  employeeId,
  byKind: {},
  total: 0,
  busy: [],
  absentDates: [],
});
const worker = (employeeId: number, patch: Partial<WorkerLoad>): WorkerLoad => ({ ...idleWorker(employeeId), ...patch });

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
    const assignments = distributeFairly(slots, [idleWorker(1), idleWorker(2), idleWorker(3)]);
    expect(assignments).toHaveLength(4);

    const counts = new Map<number, number>();
    for (const a of assignments) counts.set(a.employeeId, (counts.get(a.employeeId) ?? 0) + 1);
    const values = [...counts.values()];
    // spread like 2/1/1, not 4/0/0
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
    expect(values.every((v) => v < 4)).toBe(true);
    expect(counts.size).toBeGreaterThan(1);
  });

  it("balances each kind on its own — the night veteran still gets mornings", () => {
    // Worker 1 already carries every night; worker 2 carries every morning.
    const workers = [
      worker(1, { byKind: { Ночь: 3 }, total: 3 }),
      worker(2, { byKind: { Утро: 3 }, total: 3 }),
    ];
    const slots = [
      slot(1, "2026-07-01", "23:00", "07:00", "Ночь"),
      slot(2, "2026-07-02", "08:00", "17:00", "Утро"),
    ];
    const assignments = distributeFairly(slots, workers);
    const forSlot = (id: number) => assignments.find((a) => a.shiftId === id)?.employeeId;
    expect(forSlot(1)).toBe(2); // the night goes to whoever has fewest nights
    expect(forSlot(2)).toBe(1); // the morning goes to whoever has fewest mornings
  });

  it("ignores hours: a long-houred worker still gets the kind they have least of", () => {
    // Worker 1 works far more hours overall, but has never had a Ночь.
    const workers = [
      worker(1, { byKind: { Утро: 5, День: 5 }, total: 10 }),
      worker(2, { byKind: { Ночь: 2 }, total: 2 }),
    ];
    const assignments = distributeFairly([slot(1, "2026-07-01", "23:00", "07:00", "Ночь")], workers);
    expect(assignments[0]!.employeeId).toBe(1);
  });

  it("gives a worker already loaded with that kind fewer new slots of it than idle peers", () => {
    const slots = [
      slot(1, "2026-07-01", "23:00", "07:00"),
      slot(2, "2026-07-02", "23:00", "07:00"),
      slot(3, "2026-07-03", "23:00", "07:00"),
    ];
    const workers = [worker(1, { byKind: { Ночь: 10 }, total: 10 }), idleWorker(2), idleWorker(3)];
    const assignments = distributeFairly(slots, workers);
    const countFor = (id: number) => assignments.filter((a) => a.employeeId === id).length;
    expect(countFor(1)).toBeLessThan(countFor(2));
    expect(countFor(1)).toBeLessThan(countFor(3));
  });

  it("does not assign a slot to a worker whose busy overlaps it", () => {
    const slots = [slot(1, "2026-07-01", "09:00", "17:00", "День")];
    const workers = [worker(1, { busy: [{ date: "2026-07-01", start: "08:00", end: "18:00" }] }), idleWorker(2)];
    const assignments = distributeFairly(slots, workers);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.employeeId).toBe(2);
  });

  it("leaves a slot unassigned when more slots than free workers overlap the same time", () => {
    const slots = [
      slot(1, "2026-07-01", "09:00", "17:00", "День"),
      slot(2, "2026-07-01", "10:00", "18:00", "День"),
      slot(3, "2026-07-01", "11:00", "19:00", "День"),
    ];
    const assignments = distributeFairly(slots, [idleWorker(1), idleWorker(2)]);
    expect(assignments.length).toBeLessThan(slots.length);
    expect(assignments).toHaveLength(2);
  });

  it("does not assign a slot to a worker who is absent on that date, even with the fewest of that kind", () => {
    const slots = [slot(1, "2026-07-01", "23:00", "07:00")];
    const workers = [worker(1, { absentDates: ["2026-07-01"] }), worker(2, { byKind: { Ночь: 5 }, total: 5 })];
    const assignments = distributeFairly(slots, workers);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]!.employeeId).toBe(2);
  });

  it("leaves a slot unassigned when the only candidate is absent on that date", () => {
    const assignments = distributeFairly([slot(1, "2026-07-01", "23:00", "07:00")], [
      worker(1, { absentDates: ["2026-07-01"] }),
    ]);
    expect(assignments).toHaveLength(0);
  });
});
