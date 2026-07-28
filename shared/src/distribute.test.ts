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

describe("pools — who is allowed to take a kind at all", () => {
  const nightAt = (id: number, date: string, patch: Partial<FillSlot> = {}): FillSlot =>
    ({ ...slot(id, date, "15:00", "23:00", "Ночь"), ...patch });

  it("hands the slot only to people in the pool, however idle the others are", () => {
    const slots = [nightAt(1, "2026-08-03", { pool: [2] })];
    const out = distributeFairly(slots, [idleWorker(1), idleWorker(2), idleWorker(3)]);
    expect(out).toEqual([{ shiftId: 1, employeeId: 2 }]);
  });

  it("leaves the slot empty rather than giving it to somebody outside the pool", () => {
    // The pool member is away; nobody else may stand in.
    const slots = [nightAt(1, "2026-08-03", { pool: [2] })];
    const workers = [idleWorker(1), worker(2, { absentDates: ["2026-08-03"] }), idleWorker(3)];
    expect(distributeFairly(slots, workers)).toEqual([]);
  });

  it("still spreads fairly inside the pool", () => {
    const slots = [
      nightAt(1, "2026-08-03", { pool: [2, 3] }),
      nightAt(2, "2026-08-04", { pool: [2, 3] }),
      nightAt(3, "2026-08-05", { pool: [2, 3] }),
      nightAt(4, "2026-08-06", { pool: [2, 3] }),
    ];
    const out = distributeFairly(slots, [idleWorker(1), idleWorker(2), idleWorker(3)]);
    const counts = out.reduce<Record<number, number>>((acc, a) => ({ ...acc, [a.employeeId]: (acc[a.employeeId] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 2: 2, 3: 2 });
    expect(out.some((a) => a.employeeId === 1)).toBe(false);
  });

  it("treats an empty or missing pool as «everyone», which is an unconfigured preset", () => {
    const everyone = distributeFairly([nightAt(1, "2026-08-03", { pool: [] })], [idleWorker(7), idleWorker(8)]);
    const absent = distributeFairly([nightAt(2, "2026-08-03")], [idleWorker(7), idleWorker(8)]);
    expect(everyone).toEqual([{ shiftId: 1, employeeId: 7 }]);
    expect(absent).toEqual([{ shiftId: 2, employeeId: 7 }]);
  });
});

describe("preferences — who asked for a kind", () => {
  const evening = (id: number, date: string, patch: Partial<FillSlot> = {}): FillSlot =>
    ({ ...slot(id, date, "12:00", "20:00", "Вечер"), ...patch });

  it("breaks a tie in favour of whoever likes the kind", () => {
    // Both level on «Вечер»; 2 asked for evenings, so 2 gets it even though 1 has the lower id.
    const out = distributeFairly([evening(1, "2026-08-03", { preference: { 2: 1 } })], [idleWorker(1), idleWorker(2)]);
    expect(out).toEqual([{ shiftId: 1, employeeId: 2 }]);
  });

  it("never overrides fairness — a preference only settles a tie", () => {
    // 2 loves evenings but already holds one; 1 holds none, so 1 takes this one.
    const workers = [idleWorker(1), worker(2, { byKind: { "Вечер": 1 }, total: 1 })];
    const out = distributeFairly([evening(1, "2026-08-03", { preference: { 2: 5 } })], workers);
    expect(out).toEqual([{ shiftId: 1, employeeId: 1 }]);
  });

  it("ranks by weight when several people asked for the same kind", () => {
    const out = distributeFairly(
      [evening(1, "2026-08-03", { preference: { 1: 1, 2: 3 } })],
      [idleWorker(1), idleWorker(2)],
    );
    expect(out).toEqual([{ shiftId: 1, employeeId: 2 }]);
  });

  it("sits above the overall total, or it would never fire", () => {
    // 1 has fewer shifts overall, but both are level on «Вечер» and 2 asked for it.
    // If preference ranked below `total`, 1 would win and the setting would be dead.
    const workers = [idleWorker(1), worker(2, { byKind: { "Утро": 2 }, total: 2 })];
    const out = distributeFairly([evening(1, "2026-08-03", { preference: { 2: 1 } })], workers);
    expect(out).toEqual([{ shiftId: 1, employeeId: 2 }]);
  });

  it("ignores a preference from somebody outside the pool", () => {
    const out = distributeFairly(
      [evening(1, "2026-08-03", { pool: [1], preference: { 2: 9 } })],
      [idleWorker(1), idleWorker(2)],
    );
    expect(out).toEqual([{ shiftId: 1, employeeId: 1 }]);
  });
});
