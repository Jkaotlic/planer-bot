import { describe, it, expect } from "vitest";
import { makeTestDb } from "./testdb";
import { shiftTemplates } from "./schema";

/** The authoritative preset table — mirrors the spec's §8.3. Migration 0006 must produce exactly this. */
const EXPECTED = [
  { id: 1, name: "Утро",                    category: "shift", accent: "gold",   location: null,        start: "08:00", end: "17:00", fridayStart: "08:00", fridayEnd: "15:45", isLate: false, sendReminder: true },
  { id: 2, name: "День",                    category: "shift", accent: "blue",   location: null,        start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: false },
  { id: 3, name: "Вечер",                   category: "shift", accent: "violet", location: null,        start: "11:00", end: "20:00", fridayStart: "12:00", fridayEnd: "20:00", isLate: true, sendReminder: false },
  { id: 4, name: "Ночь",                    category: "shift", accent: "indigo", location: null,        start: "15:00", end: "23:00", fridayStart: "16:00", fridayEnd: "23:00", isLate: true, sendReminder: true },
  { id: 5, name: "Дежурство · Поклонка",    category: "duty",  accent: "teal",   location: "Поклонка",  start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true },
  { id: 6, name: "Дежурство с 07:00",       category: "duty",  accent: "amber",  location: null,        start: "07:00", end: "16:00", fridayStart: "07:00", fridayEnd: "14:45", isLate: false, sendReminder: true },
  { id: 7, name: "Дежурство · Телефон",     category: "duty",  accent: "rose",   location: null,        start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true },
  { id: 8, name: "Дежурство · Вавилова 19", category: "duty",  accent: "green",  location: "Вавилова 19", start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true },
  // Added by 0012 for the roster's `rezerv` — the reserve duty officer.
  { id: 9, name: "Дежурство · Резерв", category: "duty",  accent: "emerald", location: null, start: "09:00", end: "18:00", fridayStart: "09:00", fridayEnd: "16:45", isLate: false, sendReminder: true },
];

describe("presets created by migration 0006", () => {
  it("creates every preset with the confirmed decode values", () => {
    const rows = makeTestDb().select().from(shiftTemplates).orderBy(shiftTemplates.id).all();
    expect(rows).toHaveLength(EXPECTED.length);
    for (const want of EXPECTED) {
      const row = rows.find((r) => r.id === want.id)!;
      expect({
        id: row.id, name: row.name, category: row.category, accent: row.accent,
        location: row.location, start: row.start, end: row.end,
        fridayStart: row.fridayStart, fridayEnd: row.fridayEnd,
        isLate: row.isLate, sendReminder: row.sendReminder,
      }).toEqual(want);
    }
  });

  it("fixes the Поклонка hours — the bug was 09:00-21:00", () => {
    const rows = makeTestDb().select().from(shiftTemplates).all();
    const poklonka = rows.find((r) => r.name === "Дежурство · Поклонка")!;
    expect(poklonka.end).toBe("18:00");
    expect(poklonka.fridayEnd).toBe("16:45");
  });

  it("leaves every preset inert — Stage 3 turns roles on, not this one", () => {
    const rows = makeTestDb().select().from(shiftTemplates).all();
    expect(rows.every((r) => r.coverage === "0,0,0,0,0,0,0")).toBe(true);
    expect(rows.every((r) => r.fillMode === "count")).toBe(true);
    expect(rows.every((r) => r.primaryEmployeeId === null)).toBe(true);
  });

  it("gives every preset its own accent so they read apart", () => {
    const accents = makeTestDb().select().from(shiftTemplates).all().map((r) => r.accent);
    expect(new Set(accents).size).toBe(accents.length);
  });
});
