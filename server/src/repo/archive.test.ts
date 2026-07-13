import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, linkTelegramAccount, listActive } from "./employees";
import { archiveEmployee, restoreEmployee, listArchived } from "./employees";
import { createShift, getShift, listUpcomingForEmployee } from "./shifts";

describe("archive / restore employee", () => {
  it("archives: deactivates, stamps archivedAt, unassigns future shifts, keeps past", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const future = createShift(db, { date: "2026-07-10", start: "08:00", end: "17:00", employeeId: anya.id });
    const past = createShift(db, { date: "2026-06-01", start: "08:00", end: "17:00", employeeId: anya.id });

    const archived = archiveEmployee(db, anya.id, "2026-07-05");
    expect(archived?.isActive).toBe(false);
    expect(archived?.archivedAt).toBeInstanceOf(Date);

    expect(getShift(db, future.id)?.employeeId).toBeNull();     // future unassigned
    expect(getShift(db, past.id)?.employeeId).toBe(anya.id);    // past kept
    expect(listActive(db).map((e) => e.id)).not.toContain(anya.id);
    expect(listArchived(db).map((e) => e.id)).toContain(anya.id);
  });

  it("restores: reactivates and clears archivedAt", () => {
    const db = makeTestDb();
    const w = createEmployee(db, { displayName: "Игорь", inviteToken: "tok" });
    linkTelegramAccount(db, "tok", 777);
    archiveEmployee(db, w.id, "2026-07-05");

    const restored = restoreEmployee(db, w.id);
    expect(restored?.isActive).toBe(true);
    expect(restored?.archivedAt).toBeNull();
    expect(listActive(db).map((e) => e.id)).toContain(w.id);
  });

  it("stores an all-day absence entry (vacation) with a date range and no times", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const vac = createShift(db, { date: "2026-07-10", endDate: "2026-07-20", category: "vacation", employeeId: anya.id });
    const row = getShift(db, vac.id);
    expect(row?.category).toBe("vacation");
    expect(row?.endDate).toBe("2026-07-20");
    expect(row?.start).toBeNull();
    expect(row?.end).toBeNull();
    // an absence is still the employee's row but is not a swappable shift (category drives that)
    expect(listUpcomingForEmployee(db, anya.id, "2026-07-01").map((s) => s.id)).toContain(vac.id);
  });
});
