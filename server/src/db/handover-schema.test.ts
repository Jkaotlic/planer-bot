import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { handovers, handoverDeclines, employees } from "./schema";

/** A person to hang the foreign keys on — the tables below reference `employees`. */
function person(db: ReturnType<typeof makeTestDb>, displayName: string): number {
  return db.insert(employees).values({ displayName }).returning().get().id;
}

describe("handover tables", () => {
  it("keeps a handover after its shift is gone", () => {
    // `shiftId` is nullable on purpose: the row has to outlive the entry it
    // pointed at, exactly like `swap_requests.fromShiftId`. History stays history.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const row = db
      .insert(handovers)
      .values({ shiftId: null, fromEmployeeId: anya, sickEntryId: null, status: "expired" })
      .returning()
      .get();
    expect(row.shiftId).toBeNull();
    expect(row.escalatedAt).toBeNull();
  });

  it("refuses the same person declining one handover twice", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const handover = db.insert(handovers).values({ fromEmployeeId: anya, status: "fanned" }).returning().get();
    db.insert(handoverDeclines).values({ handoverId: handover.id, employeeId: igor }).run();
    expect(() =>
      db.insert(handoverDeclines).values({ handoverId: handover.id, employeeId: igor }).run(),
    ).toThrow();
  });

  it("lets the same person decline two different handovers", () => {
    // The uniqueness is on the pair, not on the person: a sick leave covering two
    // days makes two handovers, and one colleague may be unable to take either.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const first = db.insert(handovers).values({ fromEmployeeId: anya, status: "fanned" }).returning().get();
    const second = db.insert(handovers).values({ fromEmployeeId: anya, status: "fanned" }).returning().get();
    db.insert(handoverDeclines).values({ handoverId: first.id, employeeId: igor }).run();
    expect(() =>
      db.insert(handoverDeclines).values({ handoverId: second.id, employeeId: igor }).run(),
    ).not.toThrow();
  });
});
