import { describe, it, expect, vi } from "vitest";
import type Database from "better-sqlite3";
import { makeTestDb } from "../db/testdb";
import { archiveEmployee, createEmployee, employeesByIds, getEmployeeById } from "./employees";

describe("employeesByIds", () => {
  it("отдаёт тех же сотрудников, что getEmployeeById, включая архивных; повторы и чужие id не мешают", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const igor = createEmployee(db, { displayName: "Игорь" });
    archiveEmployee(db, igor.id, "2026-10-15");
    const map = employeesByIds(db, [anya.id, igor.id, anya.id, 9999]);
    expect([...map.keys()].sort()).toEqual([anya.id, igor.id].sort());
    expect(map.get(anya.id)).toEqual(getEmployeeById(db, anya.id));
    expect(map.get(igor.id)).toEqual(getEmployeeById(db, igor.id));
  });

  it("пустой список — пустая карта без запроса; иначе — один запрос на всех", () => {
    const db = makeTestDb();
    const ids = ["Аня", "Игорь", "Марк"].map((displayName) => createEmployee(db, { displayName }).id);
    const sqlite = (db as unknown as { $client: Database.Database }).$client;
    const spy = vi.spyOn(sqlite, "prepare");
    expect(employeesByIds(db, []).size).toBe(0);
    expect(spy).not.toHaveBeenCalled();
    expect(employeesByIds(db, ids).size).toBe(3);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});
