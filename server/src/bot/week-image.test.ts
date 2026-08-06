import { describe, it, expect } from "vitest";
import { makeTestDb } from "../db/testdb";
import { createEmployee, archiveEmployee } from "../repo/employees";
import { createShift } from "../repo/shifts";
import { buildWeekImage } from "./week-image";

const MONDAY = "2026-08-03";
const TODAY = "2026-08-06";

describe("buildWeekImage", () => {
  it("отдаёт PNG с подписью недели", () => {
    const db = makeTestDb();
    const ivanov = createEmployee(db, { displayName: "Иванов Иван" });
    createShift(db, { employeeId: ivanov.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });

    const result = buildWeekImage(db, MONDAY, TODAY);

    expect(result.kind).toBe("photo");
    if (result.kind !== "photo") return;
    expect(result.png.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(result.caption).toContain("Команда");
    expect(result.caption).toContain("август");
  });

  it("пустой ростер отвечает словами, а не пустой сеткой", () => {
    const db = makeTestDb();
    const result = buildWeekImage(db, MONDAY, TODAY);
    expect(result).toEqual({ kind: "text", text: "В расписании пока никого." });
  });

  it("каждый человек добавляет картинке ровно одну строку высоты", () => {
    // The image width equals the SVG width, so the scale is 1:1 and the PNG
    // height matches the layout height byte for byte. Height sits in IHDR at byte 20.
    const onePerson = makeTestDb();
    createEmployee(onePerson, { displayName: "Иванов Иван" });
    const twoPeople = makeTestDb();
    createEmployee(twoPeople, { displayName: "Иванов Иван" });
    createEmployee(twoPeople, { displayName: "Петров Пётр" });

    const a = buildWeekImage(onePerson, MONDAY, TODAY);
    const b = buildWeekImage(twoPeople, MONDAY, TODAY);

    expect(a.kind).toBe("photo");
    expect(b.kind).toBe("photo");
    if (a.kind !== "photo" || b.kind !== "photo") return;
    // ROW_H from week-svg.ts. A person with no entries still gets their own row —
    // an empty row is the fact "this week they don't work", not an absence.
    expect(b.png.readUInt32BE(20) - a.png.readUInt32BE(20)).toBe(56);
  });

  it("подпись называет ту неделю, которую нарисовал", () => {
    const db = makeTestDb();
    createEmployee(db, { displayName: "Иванов Иван" });

    // Week of July 27 – Aug 2: the caption must cross the month boundary.
    const result = buildWeekImage(db, "2026-07-27", TODAY);

    expect(result.kind).toBe("photo");
    if (result.kind !== "photo") return;
    expect(result.caption).toContain("июля");
    expect(result.caption).toContain("августа");
  });

  it("смена архивного человека не оставляет на картинке ни следа", () => {
    // Two databases differing by exactly one ghost: the first has an archived
    // Petrov with a shift, the second doesn't have him at all. The image must
    // come out byte-for-byte identical — that's what "didn't land" means: neither
    // its own cell nor an "Не назначено" row.
    const withGhost = makeTestDb();
    createEmployee(withGhost, { displayName: "Иванов Иван" });
    const departed = createEmployee(withGhost, { displayName: "Петров Пётр" });
    createShift(withGhost, { employeeId: departed.id, date: "2026-08-05", start: "08:00", end: "20:00", category: "shift" });
    // Archive date AFTER the shift: the shift stays with the archived person, but
    // his row is already gone.
    archiveEmployee(withGhost, departed.id, "2026-08-06");

    const clean = makeTestDb();
    createEmployee(clean, { displayName: "Иванов Иван" });

    const a = buildWeekImage(withGhost, MONDAY, TODAY);
    const b = buildWeekImage(clean, MONDAY, TODAY);

    expect(a.kind).toBe("photo");
    expect(b.kind).toBe("photo");
    if (a.kind !== "photo" || b.kind !== "photo") return;
    expect(a.png.equals(b.png)).toBe(true);
  });
});
