import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, handovers, type Handover } from "../db/schema";
import { createHandover, getHandover } from "./handovers";
import { transition } from "./transition";

function person(db: ReturnType<typeof makeTestDb>, displayName: string): number {
  return db.insert(employees).values({ displayName }).returning().get().id;
}

describe("transition", () => {
  it("из двух одинаковых переходов проходит ровно один", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const row = createHandover(db, { fromEmployeeId: anya, status: "offered", offeredToEmployeeId: igor });

    const first = transition<Handover>(db, handovers, row.id, ["offered"], { status: "fanned", offeredToEmployeeId: null });
    const second = transition<Handover>(db, handovers, row.id, ["offered"], { status: "fanned", offeredToEmployeeId: null });

    expect([first, second]).toEqual([true, false]);
    expect(getHandover(db, row.id)).toMatchObject({ status: "fanned", offeredToEmployeeId: null });
  });

  it("строку в чужом статусе не трогает вовсе — ни статус, ни остальные поля", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const row = createHandover(db, { fromEmployeeId: anya, status: "taken", takenByEmployeeId: igor });

    expect(transition<Handover>(db, handovers, row.id, ["offered", "fanned"], { status: "cancelled", takenByEmployeeId: null })).toBe(false);
    expect(getHandover(db, row.id)).toMatchObject({ status: "taken", takenByEmployeeId: igor });
  });

  it("переход касается только своей строки", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const mine = createHandover(db, { fromEmployeeId: anya, status: "offered" });
    const other = createHandover(db, { fromEmployeeId: anya, status: "offered" });

    expect(transition<Handover>(db, handovers, mine.id, ["offered"], { status: "fanned" })).toBe(true);
    expect(getHandover(db, other.id)?.status).toBe("offered");
  });
});
