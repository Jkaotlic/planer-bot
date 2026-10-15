import { describe, it, expect } from "vitest";
import { isAbsentOn, waitsForCover } from "./absence";

const sick = { employeeId: 1, category: "sick_leave" as const, date: "2026-08-12", endDate: "2026-08-14" };

describe("isAbsentOn", () => {
  it("день внутри больничного — отсутствует", () => {
    expect(isAbsentOn([sick], 1, "2026-08-13")).toBe(true);
  });
  it("границы date и endDate — тоже отсутствует", () => {
    expect(isAbsentOn([sick], 1, "2026-08-12")).toBe(true);
    expect(isAbsentOn([sick], 1, "2026-08-14")).toBe(true);
  });
  it("день после — нет", () => {
    expect(isAbsentOn([sick], 1, "2026-08-15")).toBe(false);
  });
  it("чужой больничный — нет", () => {
    expect(isAbsentOn([sick], 2, "2026-08-13")).toBe(false);
  });
  it("смена — не отсутствие", () => {
    expect(isAbsentOn([{ ...sick, category: "shift" as const, endDate: null }], 1, "2026-08-12")).toBe(false);
  });
  it("однодневное отсутствие без endDate", () => {
    expect(isAbsentOn([{ ...sick, category: "vacation" as const, endDate: null }], 1, "2026-08-12")).toBe(true);
  });
});

describe("waitsForCover — смена ждёт замены", () => {
  const work = { employeeId: 1, category: "shift" as const, date: "2026-08-13", endDate: null };

  it("смена человека в день его больничного — ждёт", () => {
    expect(waitsForCover(work, [work, sick], "2026-08-13")).toBe(true);
  });
  it("смена в день вне отсутствия — не ждёт", () => {
    const later = { ...work, date: "2026-08-15" };
    expect(waitsForCover(later, [later, sick], "2026-08-15")).toBe(false);
  });
  it("само отсутствие замены не ждёт", () => {
    expect(waitsForCover(sick, [sick], "2026-08-13")).toBe(false);
  });
  it("пустой слот — не про человека, не ждёт", () => {
    const slot = { ...work, employeeId: null };
    expect(waitsForCover(slot, [slot, sick], "2026-08-13")).toBe(false);
  });
  it("дата вне самой записи — не ждёт", () => {
    expect(waitsForCover(work, [work, sick], "2026-08-12")).toBe(false);
  });
});
