import { describe, expect, it } from "vitest";
import type { Shift } from "../api/client";
import { coworkersOf } from "./coworkers";

const DAY = "2026-09-10";

const shift = (over: Partial<Shift> & { id: number }): Shift =>
  ({
    date: DAY,
    endDate: null,
    start: "09:00",
    end: "18:00",
    category: "shift",
    title: null,
    templateId: 2,
    employeeId: 2,
    employeeName: "Игорь",
    location: null,
    note: null,
    unrecognisedCode: null,
    ...over,
  }) as Shift;

describe("coworkersOf", () => {
  it("исключает себя", () => {
    const me = shift({ id: 1, employeeId: 1, employeeName: "Аня" });
    const other = shift({ id: 2 });
    expect(coworkersOf([me, other], 1).map((s) => s.id)).toEqual([2]);
  });

  it("исключает отпуск и другие отсутствия", () => {
    const vacation = shift({ id: 2, category: "vacation", start: null, end: null });
    expect(coworkersOf([vacation], 1)).toEqual([]);
  });

  it("исключает запись без времени (нечитаемая клетка импорта)", () => {
    const timeless = shift({ id: 2, start: null, end: null });
    expect(coworkersOf([timeless], 1)).toEqual([]);
  });

  it("вакантную запись (без employeeId) не показывает", () => {
    const vacant = shift({ id: 2, employeeId: null, employeeName: undefined });
    expect(coworkersOf([vacant], 1)).toEqual([]);
  });

  it("сортирует по началу, потом по имени", () => {
    const later = shift({ id: 2, employeeId: 2, employeeName: "Марк", start: "12:00", end: "20:00" });
    const earlierB = shift({ id: 3, employeeId: 3, employeeName: "Семён", start: "07:00", end: "15:00" });
    const earlierA = shift({ id: 4, employeeId: 4, employeeName: "Аня", start: "07:00", end: "15:00" });
    const result = coworkersOf([later, earlierB, earlierA], 1);
    expect(result.map((s) => s.employeeName)).toEqual(["Аня", "Семён", "Марк"]);
  });
});
