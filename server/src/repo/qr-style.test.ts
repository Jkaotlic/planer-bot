import { describe, expect, it } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, getEmployeeById, setQrStyle } from "./employees";

describe("setQrStyle", () => {
  it("stores only shape and colour — a caption must never ride into every future bot code", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    setQrStyle(db, anya.id, { shape: "dots", color: "blue", caption: "Сбор" } as never);
    expect(JSON.parse(getEmployeeById(db, anya.id)!.qrStyle!)).toEqual({ shape: "dots", color: "blue" });
  });

  it("changes nobody else's style", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    setQrStyle(db, anya.id, { shape: "soft", color: "green" });
    expect(getEmployeeById(db, igor.id)!.qrStyle).toBeNull();
  });
});
