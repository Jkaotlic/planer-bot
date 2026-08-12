import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { employees, shifts, shiftTemplates, templatePool, type Shift } from "../db/schema";
import { handoverCandidates } from "./candidates";

type TestDb = ReturnType<typeof makeTestDb>;

function person(db: TestDb, displayName: string, patch: { isActive?: boolean; excludedFromSwaps?: boolean } = {}): number {
  return db.insert(employees).values({ displayName, ...patch }).returning().get().id;
}

function entry(
  db: TestDb,
  employeeId: number,
  patch: { date?: string; start?: string | null; end?: string | null; templateId?: number | null } = {},
): Shift {
  return db
    .insert(shifts)
    .values({
      date: patch.date ?? "2026-08-12",
      start: patch.start === undefined ? "09:00" : patch.start,
      end: patch.end === undefined ? "18:00" : patch.end,
      category: "shift",
      employeeId,
      templateId: patch.templateId ?? null,
    })
    .returning()
    .get();
}

describe("who can be offered a shift", () => {
  it("leaves out the person who is giving it away", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    expect(handoverCandidates(db, entry(db, anya)).map((e) => e.id)).toEqual([igor]);
  });

  it("leaves out anybody whose own entry overlaps those hours", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const shift = entry(db, anya);
    entry(db, igor, { start: "12:00", end: "20:00" });
    // Марк works the same day but after it ends — free for this one.
    entry(db, mark, { start: "18:00", end: "23:00" });
    expect(handoverCandidates(db, shift).map((e) => e.id)).toEqual([mark]);
  });

  it("leaves out people an admin took out of swaps", () => {
    // The owner's decision from заход 1: «выведенные из обменов не участвуют».
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь", { excludedFromSwaps: true });
    const mark = person(db, "Марк");
    expect(handoverCandidates(db, entry(db, anya)).map((e) => e.id)).toEqual([mark]);
  });

  it("leaves out archived people", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    person(db, "Игорь", { isActive: false });
    const mark = person(db, "Марк");
    expect(handoverCandidates(db, entry(db, anya)).map((e) => e.id)).toEqual([mark]);
  });

  it("leaves out everybody already asked", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    expect(handoverCandidates(db, entry(db, anya), { excludeIds: [igor] }).map((e) => e.id)).toEqual([mark]);
  });

  it("puts the duty pool first without shutting anybody out", () => {
    // Пул — приоритет, а не забор: решение владельца от 2026-08-10, принятое с
    // названным вслух риском. Проверка одного порядка пропустила бы превращение
    // приоритета в забор, поэтому здесь проверяется И порядок, И состав.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const mark = person(db, "Марк");
    const duty = db
      .insert(shiftTemplates)
      .values({ name: "Дежурство · Поклонка", start: "10:00", end: "19:00", accent: "emerald" })
      .returning()
      .get();
    db.insert(templatePool).values({ templateId: duty.id, employeeId: mark }).run();
    const shift = entry(db, anya, { templateId: duty.id });
    expect(handoverCandidates(db, shift).map((e) => e.id)).toEqual([mark, igor]);
  });

  it("says nobody when nobody is free", () => {
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const shift = entry(db, anya);
    entry(db, igor);
    expect(handoverCandidates(db, shift)).toEqual([]);
  });

  it("treats an all-day absence as covering the whole day", () => {
    // У отсутствия нет времени, и «пересечения нет» здесь читалось бы как
    // «человек свободен» — а он в отпуске.
    const db = makeTestDb();
    const anya = person(db, "Аня");
    const igor = person(db, "Игорь");
    const shift = entry(db, anya);
    db.insert(shifts).values({ date: "2026-08-12", category: "vacation", employeeId: igor }).run();
    expect(handoverCandidates(db, shift)).toEqual([]);
  });
});
