import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts } from "../db/schema";
import {
  createHandover,
  getHandover,
  listLiveHandovers,
  listHandoversForEntry,
  updateHandover,
  addDecline,
  listDeclines,
} from "./handovers";

function person(db: ReturnType<typeof makeTestDb>, displayName: string): number {
  return db.insert(employees).values({ displayName }).returning().get().id;
}

function sickLeave(db: ReturnType<typeof makeTestDb>, employeeId: number, date: string): number {
  return db.insert(shifts).values({ date, category: "sick_leave", employeeId }).returning().get().id;
}

describe("handover repo", () => {
  it("lists only the ones the tick still has to look at", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const live = createHandover(db, { fromEmployeeId: anya, status: "offered" });
    createHandover(db, { fromEmployeeId: anya, status: "taken" });
    createHandover(db, { fromEmployeeId: anya, status: "cancelled" });
    createHandover(db, { fromEmployeeId: anya, status: "expired" });
    expect(listLiveHandovers(db).map((h) => h.id)).toEqual([live.id]);
  });

  it("counts a fanned handover as live too — it is still waiting for somebody", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const fanned = createHandover(db, { fromEmployeeId: anya, status: "fanned" });
    expect(listLiveHandovers(db).map((h) => h.id)).toEqual([fanned.id]);
  });

  it("finds every handover a sick leave spawned", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    // Real entry rows, not made-up ids: `sickEntryId` is a foreign key, and a
    // fixture that dodges it would prove the query on data the table cannot hold.
    const sick = sickLeave(db, anya, "2026-08-12");
    const otherSick = sickLeave(db, anya, "2026-09-01");
    const first = createHandover(db, { fromEmployeeId: anya, sickEntryId: sick });
    const second = createHandover(db, { fromEmployeeId: anya, sickEntryId: sick });
    createHandover(db, { fromEmployeeId: anya, sickEntryId: otherSick });
    expect(listHandoversForEntry(db, sick).map((h) => h.id).sort()).toEqual([first.id, second.id].sort());
  });

  it("keeps refusals per handover, not per person", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const first = createHandover(db, { fromEmployeeId: anya });
    const second = createHandover(db, { fromEmployeeId: anya });
    addDecline(db, first.id, igor);
    addDecline(db, second.id, mark);
    expect(listDeclines(db, first.id)).toEqual([igor]);
  });

  it("a second refusal from the same person is not an error the caller must handle", () => {
    // The fan-out writes to a dozen people and any of them may tap twice. A throw
    // here would abort a broadcast halfway through, leaving half the team told.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const handover = createHandover(db, { fromEmployeeId: anya });
    addDecline(db, handover.id, igor);
    expect(() => addDecline(db, handover.id, igor)).not.toThrow();
    expect(listDeclines(db, handover.id)).toEqual([igor]);
  });

  it("updates what the tick writes back", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const handover = createHandover(db, { fromEmployeeId: anya });
    const at = new Date(Date.UTC(2026, 7, 12, 9, 0));
    updateHandover(db, handover.id, { status: "fanned", offeredToEmployeeId: null, escalatedAt: at });
    const after = getHandover(db, handover.id);
    expect(after?.status).toBe("fanned");
    expect(after?.escalatedAt?.getTime()).toBe(at.getTime());
  });
});
