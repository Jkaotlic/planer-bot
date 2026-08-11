import { describe, expect, it } from "vitest";

import type { Db } from "../db/client";
import { makeTestDb } from "../db/testdb";
import { createEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { dayAfterLine } from "./day-summary";

const DAY = "2026-08-12";

const shiftOn = (db: Db, employeeId: number, title: string, start: string, end: string) =>
  createShift(db, { date: DAY, start, end, endDate: null, category: "shift", title, employeeId });

describe("что осталось у человека на этот день", () => {
  it("две записи — перечисляет обе, потому что человек про это ещё не знает", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    shiftOn(db, worker.id, "День", "09:00", "18:00");
    const evening = shiftOn(db, worker.id, "Вечер", "11:00", "20:00");

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: evening.id })).toBe(
      "Теперь на Ср 12 авг у тебя: 09:00–18:00 · День, 11:00–20:00 · Вечер.",
    );
  });

  it("осталась одна запись, и это та самая — молчит, письмо её уже назвало", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const only = shiftOn(db, worker.id, "День", "09:00", "18:00");

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: only.id })).toBeNull();
  });

  it("осталась одна, но другая — говорит, иначе человек не узнает, что у него теперь", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const staying = shiftOn(db, worker.id, "Вечер", "11:00", "20:00");

    // 9999 — id только что удалённой записи, её в базе уже нет.
    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: 9999 })).toBe(
      "Теперь на Ср 12 авг у тебя: 11:00–20:00 · Вечер.",
    );
    expect(staying.id).not.toBe(9999);
  });

  it("день опустел — про это сказать надо", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: 9999 })).toBe(
      "Теперь на Ср 12 авг у тебя ничего.",
    );
  });

  it("чужие записи того же дня не считаются", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    const other = createEmployee(db, { displayName: "Марк" });
    const mine = shiftOn(db, worker.id, "День", "09:00", "18:00");
    shiftOn(db, other.id, "Вечер", "11:00", "20:00");

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: mine.id })).toBeNull();
  });

  it("многодневное отсутствие, накрывающее день, считается", () => {
    const db = makeTestDb();
    const worker = createEmployee(db, { displayName: "Игорь" });
    createShift(db, {
      date: "2026-08-10", endDate: "2026-08-14", start: null, end: null,
      category: "vacation", title: null, employeeId: worker.id,
    });
    const added = shiftOn(db, worker.id, "День", "09:00", "18:00");

    expect(dayAfterLine(db, { employeeId: worker.id, date: DAY, keepSilentForEntryId: added.id })).toBe(
      "Теперь на Ср 12 авг у тебя: весь день · Отпуск, 09:00–18:00 · День.",
    );
  });
});
