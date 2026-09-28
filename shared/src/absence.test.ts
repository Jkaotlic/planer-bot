import { describe, it, expect } from "vitest";
import { isAbsentOn } from "./absence";

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
