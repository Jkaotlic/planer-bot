import { afterEach, describe, expect, it } from "vitest";
import { buildTodayModel, buildWeekModel } from "../lib/team-schedule";
import { addDays, mondayOf, toISODate } from "../lib/week";
import {
  mockCreateEntry,
  mockDeleteEntry,
  mockGetTeamSchedule,
  mockGetTemplates,
  mockUpdateEntry,
} from "./mock";

const createdEntryIds: number[] = [];

afterEach(async () => {
  await Promise.all(createdEntryIds.splice(0).map((id) => mockDeleteEntry(id)));
});

describe("team schedule development mock", () => {
  it("exposes every state required by the Today and Week visual QA", async () => {
    const monday = toISODate(mondayOf(new Date()));
    const sunday = toISODate(addDays(new Date(`${monday}T12:00:00`), 6));
    const [schedule, templates] = await Promise.all([
      mockGetTeamSchedule(monday, sunday),
      mockGetTemplates(),
    ]);

    const today = buildTodayModel(monday, schedule, templates);
    expect([...new Set(today.groups.map((group) => group.start))]).toEqual([
      "07:00",
      "08:00",
      "09:00",
      "11:00",
    ]);
    expect(today.noTimeGroups.length).toBeGreaterThan(0);

    const week = buildWeekModel(monday, schedule, templates);
    expect(week.rows.some((row) => row.cells.every((cell) => cell.entries.length === 0))).toBe(true);
    expect(week.rows.some((row) => row.employeeId === null)).toBe(true);

    const visibleCodes = new Set(
      week.rows.flatMap((row) =>
        row.cells.flatMap((cell) =>
          cell.entries.flatMap((entry) => entry.palette?.code ?? []),
        ),
      ),
    );
    expect([...visibleCodes].sort()).toEqual(
      ["С", "У", "В", "Н", "Т", "ВА", "П", "07", "О"].sort(),
    );

    const detailCell = week.rows
      .flatMap((row) => row.cells)
      .find(
        (cell) =>
          cell.extraCount > 0
          && cell.entries.some((entry) => entry.shift.location)
          && cell.entries.some(
            (entry) =>
              entry.shift.endDate != null
              && entry.shift.endDate !== entry.shift.date,
          ),
      );
    expect(detailCell).toBeDefined();
  });

  it("preserves a supplied location when creating a schedule entry", async () => {
    const created = await mockCreateEntry({
      date: "2099-01-10",
      start: "09:00",
      end: "18:00",
      category: "duty",
      title: "Выездное дежурство",
      location: "Поклонка",
      employeeId: 1,
    });
    createdEntryIds.push(created.id);

    expect(created.location).toBe("Поклонка");
  });

  it("preserves an updated location and clears it when the field is omitted", async () => {
    const created = await mockCreateEntry({
      date: "2099-01-11",
      start: "09:00",
      end: "18:00",
      category: "duty",
      title: "Своя смена",
      location: "Старое место",
      employeeId: 1,
    });
    createdEntryIds.push(created.id);

    const updated = await mockUpdateEntry(created.id, {
      date: created.date,
      start: created.start ?? undefined,
      end: created.end ?? undefined,
      category: created.category,
      title: created.title,
      location: "Новое место",
      employeeId: created.employeeId ?? undefined,
    });
    expect(updated.location).toBe("Новое место");

    const cleared = await mockUpdateEntry(created.id, {
      date: created.date,
      start: created.start ?? undefined,
      end: created.end ?? undefined,
      category: created.category,
      title: created.title,
      employeeId: created.employeeId ?? undefined,
    });
    expect(cleared.location).toBeNull();
  });
});
