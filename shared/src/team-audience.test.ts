import { describe, it, expect } from "vitest";
import { teamAudienceSchema, workingOn } from "./team-audience";

const day = "2026-09-29";

describe("workingOn — кто сегодня на смене", () => {
  it("берёт смены, дежурства, выходную работу и выезд, но не отпуск", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "duty" as const, date: day, endDate: null },
      { employeeId: 3, category: "weekend_work" as const, date: day, endDate: null },
      { employeeId: 4, category: "offsite" as const, date: day, endDate: null },
      { employeeId: 5, category: "vacation" as const, date: "2026-09-28", endDate: "2026-10-02" },
    ];
    expect(workingOn(entries, day)).toEqual([1, 2, 3, 4]);
  });

  it("смена человека, который в тот же день на больничном, не считается", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: day, endDate: null },
      { employeeId: 1, category: "sick_leave" as const, date: day, endDate: null },
    ];
    expect(workingOn(entries, day)).toEqual([]);
  });

  it("смена другого дня и свободный слот без человека не попадают; дубли схлопываются", () => {
    const entries = [
      { employeeId: 1, category: "shift" as const, date: "2026-09-30", endDate: null },
      { employeeId: null, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "shift" as const, date: day, endDate: null },
      { employeeId: 2, category: "duty" as const, date: day, endDate: null },
    ];
    expect(workingOn(entries, day)).toEqual([2]);
  });
});

describe("teamAudienceSchema", () => {
  it("принимает три вида и отвергает пустой ручной список", () => {
    expect(teamAudienceSchema.safeParse({ kind: "team" }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "on_shift" }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: [1, 2] }).success).toBe(true);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: [] }).success).toBe(false);
    expect(teamAudienceSchema.safeParse({ kind: "everyone" }).success).toBe(false);
  });

  it("не пропускает список длиннее 200", () => {
    const ids = Array.from({ length: 201 }, (_, i) => i + 1);
    expect(teamAudienceSchema.safeParse({ kind: "picked", employeeIds: ids }).success).toBe(false);
  });
});
