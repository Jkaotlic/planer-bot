import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts, type Shift } from "../db/schema";
import type { EntryCategory } from "@planer/shared";
import { busyWith } from "./busy";

type TestDb = ReturnType<typeof makeTestDb>;

function person(db: TestDb, displayName: string): number {
  return db.insert(employees).values({ displayName }).returning().get().id;
}

function entry(
  db: TestDb,
  employeeId: number,
  patch: { date: string; endDate?: string | null; start: string | null; end: string | null; category?: EntryCategory },
): Shift {
  return db
    .insert(shifts)
    .values({
      date: patch.date,
      endDate: patch.endDate ?? null,
      start: patch.start,
      end: patch.end,
      category: patch.category ?? "shift",
      employeeId,
    })
    .returning()
    .get();
}

const DAY_SHIFT = { date: "2026-08-12", start: "07:00", end: "16:00" };

describe("busyWith — занят ли человек в этом интервале", () => {
  it("ночь накануне 22:00–08:00 перекрывает утро 07:00–16:00", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const night = entry(db, igor, { date: "2026-08-11", start: "22:00", end: "08:00" });
    expect(busyWith(db, igor, DAY_SHIFT)?.id).toBe(night.id);
  });

  it("ночь, кончившаяся ровно в начале смены, не мешает — граница полуинтервалом", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    entry(db, igor, { date: "2026-08-11", start: "22:00", end: "07:00" });
    expect(busyWith(db, igor, DAY_SHIFT)).toBeNull();
  });

  it("собственная ночь интервала доходит до утренней записи следующих суток", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const morning = entry(db, igor, { date: "2026-08-12", start: "07:00", end: "12:00" });
    expect(busyWith(db, igor, { date: "2026-08-11", start: "22:00", end: "08:00" })?.id).toBe(morning.id);
  });

  it("отпуск без времени в этот день — занят", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const vacation = entry(db, igor, { date: "2026-08-10", endDate: "2026-08-14", start: null, end: null, category: "vacation" });
    expect(busyWith(db, igor, DAY_SHIFT)?.id).toBe(vacation.id);
  });

  it("отпуск, кончившийся накануне, — свободен", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    entry(db, igor, { date: "2026-08-05", endDate: "2026-08-11", start: null, end: null, category: "vacation" });
    expect(busyWith(db, igor, DAY_SHIFT)).toBeNull();
  });

  it("ignoreEntryId исключает саму передаваемую смену", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const own = entry(db, igor, DAY_SHIFT);
    expect(busyWith(db, igor, DAY_SHIFT)?.id).toBe(own.id);
    expect(busyWith(db, igor, DAY_SHIFT, { ignoreEntryId: own.id })).toBeNull();
  });

  it("чужие записи не делают человека занятым", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    entry(db, mark, DAY_SHIFT);
    expect(busyWith(db, igor, DAY_SHIFT)).toBeNull();
  });

  it("интервал без времени занимает весь свой день: смена в нём — занят, смена накануне до полуночи — нет", () => {
    const db = makeTestDb();
    const igor = person(db, "Игорь");
    const allDay = { date: "2026-08-12", start: null, end: null };
    entry(db, igor, { date: "2026-08-11", start: "15:00", end: "00:00" });
    expect(busyWith(db, igor, allDay)).toBeNull();
    const evening = entry(db, igor, { date: "2026-08-12", start: "18:00", end: "23:00" });
    expect(busyWith(db, igor, allDay)?.id).toBe(evening.id);
  });
});
