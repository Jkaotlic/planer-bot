import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "../repo/employees";
import { listActiveTemplates } from "../repo/templates";
import { createShift } from "../repo/shifts";
import { buildShiftCountsReport, shiftCountsCsv } from "./shift-counts";
import type { Db } from "../db/client";

const presetId = (db: Db, name: string) => listActiveTemplates(db).find((t) => t.name === name)!.id;
const JUNE = { from: "2026-06-01", to: "2026-06-30" };

/** One worked entry of a given preset. */
function worked(db: Db, employeeId: number, templateId: number, title: string, date: string, category = "shift") {
  createShift(db, {
    employeeId, date, endDate: null, category, templateId,
    start: "09:00", end: "18:00", title,
  } as never);
}

describe("buildShiftCountsReport", () => {
  it("counts entries per person per kind", () => {
    const db = makeTestDb();
    const day = presetId(db, "День");
    const night = presetId(db, "Ночь");
    const a = createEmployee(db, { displayName: "Первый" }).id;
    const b = createEmployee(db, { displayName: "Второй" }).id;

    worked(db, a, day, "День", "2026-06-01");
    worked(db, a, day, "День", "2026-06-02");
    worked(db, a, night, "Ночь", "2026-06-03");
    worked(db, b, night, "Ночь", "2026-06-04");

    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    const row = (name: string) => report.rows.find((r) => r.displayName === name)!;
    expect(row("Первый").byKind).toEqual({ "День": 2, "Ночь": 1 });
    expect(row("Первый").total).toBe(3);
    expect(row("Второй").byKind).toEqual({ "Ночь": 1 });
  });

  it("includes somebody who did nothing, as a row of zeroes", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Отдыхал" });
    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.rows.find((r) => r.displayName === "Отдыхал")).toMatchObject({ byKind: {}, total: 0 });
  });

  it("does not count an absence as a kind of work", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Отпускник" }).id;
    createShift(db, {
      employeeId: a, date: "2026-06-01", endDate: "2026-06-14", category: "vacation",
      templateId: null, start: null, end: null, title: null,
    });
    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.rows.find((r) => r.displayName === "Отпускник")!.total).toBe(0);
    expect(report.kinds).toEqual([]);
  });

  it("counts duties, and keeps each duty as its own column", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Дежурный" }).id;
    worked(db, a, presetId(db, "Дежурство · Телефон"), "Дежурство · Телефон", "2026-06-01", "duty");
    worked(db, a, presetId(db, "Дежурство · Поклонка"), "Дежурство · Поклонка", "2026-06-02", "duty");

    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.rows[0]!.byKind).toEqual({ "Дежурство · Телефон": 1, "Дежурство · Поклонка": 1 });
  });

  it("groups a preset-less entry under «Своё время»", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Свободный" }).id;
    createShift(db, {
      employeeId: a, date: "2026-06-01", endDate: null, category: "shift",
      templateId: null, start: "10:00", end: "14:00", title: null,
    });
    expect(buildShiftCountsReport(db, JUNE.from, JUNE.to).rows[0]!.byKind).toEqual({ "Своё время": 1 });
  });

  it("labels an unread roster cell apart from a hand-timed «Своё время» shift, but still counts it", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Соколов" }).id;
    // An unread roster cell: no times, the original code kept verbatim.
    createShift(db, {
      employeeId: a, date: "2026-06-01", endDate: null, category: "shift",
      templateId: null, start: null, end: null, title: null, unrecognisedCode: "Ко",
    });
    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    const row = report.rows[0]!;
    expect(row.total).toBe(1);
    expect(row.byKind["Своё время"]).toBeUndefined();
    expect(Object.keys(row.byKind)).not.toContain("Своё время");
    // Whatever the label, it must not be the custom-time bucket, and it must carry the count.
    const [label, count] = Object.entries(row.byKind)[0]!;
    expect(label).not.toBe("Своё время");
    expect(count).toBe(1);
  });

  it("stays inside the period", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Кто-то" }).id;
    const day = presetId(db, "День");
    worked(db, a, day, "День", "2026-05-31");
    worked(db, a, day, "День", "2026-06-15");
    worked(db, a, day, "День", "2026-07-01");
    expect(buildShiftCountsReport(db, JUNE.from, JUNE.to).rows[0]!.total).toBe(1);
  });

  it("leaves an archived worker off the report", () => {
    const db = makeTestDb();
    const gone = createEmployee(db, { displayName: "Уволенный" }).id;
    worked(db, gone, presetId(db, "День"), "День", "2026-06-01");
    archiveEmployee(db, gone, "2026-06-20");
    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.rows.some((r) => r.displayName === "Уволенный")).toBe(false);
  });

  it("orders columns by the preset order, then anything one-off", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Кто-то" }).id;
    // Deliberately created out of order — the report must not echo insertion order.
    worked(db, a, presetId(db, "Ночь"), "Ночь", "2026-06-03");
    createShift(db, {
      employeeId: a, date: "2026-06-04", endDate: null, category: "shift",
      templateId: null, start: "10:00", end: "14:00", title: null,
    });
    worked(db, a, presetId(db, "Утро"), "Утро", "2026-06-01");

    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.kinds).toEqual(["Утро", "Ночь", "Своё время"]);
  });

  it("lists people in the admin's order, so the report matches every other screen", () => {
    const db = makeTestDb();
    ["Первый", "Второй", "Третий"].forEach((displayName) => createEmployee(db, { displayName }));
    const report = buildShiftCountsReport(db, JUNE.from, JUNE.to);
    expect(report.rows.map((r) => r.displayName)).toEqual(["Первый", "Второй", "Третий"]);
  });
});

describe("shiftCountsCsv", () => {
  it("writes a header, a row per person, and zeroes for kinds they didn't do", () => {
    const db = makeTestDb();
    const a = createEmployee(db, { displayName: "Первый" }).id;
    createEmployee(db, { displayName: "Второй" });
    worked(db, a, presetId(db, "День"), "День", "2026-06-01");

    const csv = shiftCountsCsv(buildShiftCountsReport(db, JUNE.from, JUNE.to));
    expect(csv.split("\r\n")).toEqual(["Работник;День;Всего", "Первый;1;1", "Второй;0;0"]);
  });

  it("quotes a name containing the delimiter", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: 'Иван; "Старший"' });
    const csv = shiftCountsCsv(buildShiftCountsReport(db, JUNE.from, JUNE.to));
    expect(csv).toContain('"Иван; ""Старший"""');
  });
});
