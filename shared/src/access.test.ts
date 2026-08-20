import { describe, it, expect } from "vitest";
import { canAnnounce, takesPartInAssignment, canSwap, canAddOwnShifts } from "./access";

/** Обычный работник без единого ограничения — состояние, в котором все
 *  запреты обязаны быть ложными, чтобы тест ловил именно новое правило. */
const worker = {
  isAdmin: false,
  isObserver: false,
  selfScheduleEnabled: false,
  excludedFromAssignment: false,
  excludedFromSwaps: false,
};
const admin = { ...worker, isAdmin: true };
const observer = { ...worker, isObserver: true };

describe("canAnnounce", () => {
  it("админ и наблюдатель — да, работник — нет", () => {
    expect(canAnnounce(admin)).toBe(true);
    expect(canAnnounce(observer)).toBe(true);
    expect(canAnnounce(worker)).toBe(false);
  });
});

describe("takesPartInAssignment", () => {
  it("наблюдатель вне раздачи ДАЖЕ со снятыми галочками", () => {
    // Ровно та проверка, ради которой заводится роль: галочки сняты, значит
    // тест зелёный только если исключает сама роль.
    expect(observer.excludedFromAssignment).toBe(false);
    expect(takesPartInAssignment(observer)).toBe(false);
  });

  it("работник со снятой галочкой в раздаче, с поднятой — нет", () => {
    expect(takesPartInAssignment(worker)).toBe(true);
    expect(takesPartInAssignment({ ...worker, excludedFromAssignment: true })).toBe(false);
  });
});

describe("canSwap", () => {
  it("наблюдатель вне обменов ДАЖЕ со снятой галочкой", () => {
    expect(observer.excludedFromSwaps).toBe(false);
    expect(canSwap(observer)).toBe(false);
  });

  it("работник меняется, пока его не исключили", () => {
    expect(canSwap(worker)).toBe(true);
    expect(canSwap({ ...worker, excludedFromSwaps: true })).toBe(false);
  });
});

describe("canAddOwnShifts", () => {
  it("нужны оба условия — роль и личный тумблер", () => {
    expect(canAddOwnShifts(observer)).toBe(false);
    expect(canAddOwnShifts({ ...observer, selfScheduleEnabled: true })).toBe(true);
    // Работнику тумблер не помогает: свой график ведёт наблюдатель, а смены
    // остальным ставит админ.
    expect(canAddOwnShifts({ ...worker, selfScheduleEnabled: true })).toBe(false);
  });
});
