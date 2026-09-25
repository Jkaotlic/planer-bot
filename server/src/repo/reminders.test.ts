import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "./employees";
import { createShift } from "./shifts";
import { hasReminder, addReminder, checklistDayKey, checklistKind, checklistUndeliverableKind, checklistDocKind } from "./reminders";

describe("reminders repo", () => {
  it("hasReminder is false until addReminder is called for that shift+kind", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const shift = createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: anya.id });

    expect(hasReminder(db, shift.id, "evening_before")).toBe(false);
    addReminder(db, shift.id, "evening_before");
    expect(hasReminder(db, shift.id, "evening_before")).toBe(true);
  });

  it("is scoped per kind — a different kind on the same shift is still unsent", () => {
    const db = makeTestDb();
    const anya = createEmployee(db, { displayName: "Аня" });
    const shift = createShift(db, { date: "2026-07-15", start: "08:00", end: "17:00", employeeId: anya.id });

    addReminder(db, shift.id, "evening_before");
    expect(hasReminder(db, shift.id, "other_kind")).toBe(false);
  });
});

describe("checklistDayKey — день в ключе только у многодневной записи", () => {
  it("однодневная запись: день не примешивается", () => {
    expect(checklistDayKey({ date: "2026-07-13", endDate: null }, "2026-07-13")).toBeUndefined();
    expect(checklistDayKey({ date: "2026-07-13", endDate: "2026-07-13" }, "2026-07-13")).toBeUndefined();
  });

  it("многодневная запись: ключ — сегодняшний день", () => {
    expect(checklistDayKey({ date: "2026-07-13", endDate: "2026-07-19" }, "2026-07-14")).toBe("2026-07-14");
  });
});

describe("checklistKind/checklistUndeliverableKind/checklistDocKind — вид без дня и с ним", () => {
  it("без дня — как раньше, без @", () => {
    expect(checklistKind(5)).toBe("duty_checklist:5");
    expect(checklistUndeliverableKind(5)).toBe("duty_checklist_undeliverable:5");
    expect(checklistDocKind(5)).toBe("duty_checklist_doc:5");
  });

  it("с днём — свой вид на каждый день", () => {
    expect(checklistKind(5, "2026-07-14")).toBe("duty_checklist:5@2026-07-14");
    expect(checklistUndeliverableKind(5, "2026-07-14")).toBe("duty_checklist_undeliverable:5@2026-07-14");
    expect(checklistDocKind(5, "2026-07-14")).toBe("duty_checklist_doc:5@2026-07-14");
  });
});
