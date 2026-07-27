import { describe, expect, it } from "vitest";
import { apiClient } from "./client";
import { mondayOf, addDays, toISODate } from "../lib/week";

/**
 * The DEV fixture seeds the CURRENT week, so any hard-coded month would collide with
 * it on some days of the year and not others. Both periods below are derived from
 * today: one deliberately clear of the fixture, one deliberately on top of it.
 */
const ru = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const emptyPeriod = [200, 201].map((offset) => toISODate(addDays(mondayOf(new Date()), offset)));
const seededMonday = toISODate(mondayOf(new Date()));

describe("development roster import client", () => {
  const csv = `;${ru(emptyPeriod[0]!)};${ru(emptyPeriod[1]!)}\r\nИгорь Петров;k32;holiday\r\nНовый Сотрудник;k32-7;holiday`;

  it("previews a selected CSV before any import is applied", async () => {
    const preview = await apiClient.previewRosterImport(csv);

    expect(preview).toEqual({
      from: emptyPeriod[0],
      to: emptyPeriod[1],
      entryCount: 2,
      people: [
        { csvName: "Игорь Петров", suggestedEmployeeId: 2 },
        { csvName: "Новый Сотрудник", suggestedEmployeeId: null },
      ],
      unknowns: [],
      preservedCount: 0,
      existingCount: 0,
    });
  });

  it("counts '?' cells as preserved rather than rejecting the file", async () => {
    const preview = await apiClient.previewRosterImport(
      `;${ru(emptyPeriod[0]!)};${ru(emptyPeriod[1]!)}\r\nИгорь Петров;?;k32`,
    );
    expect(preview.preservedCount).toBe(1);
    expect(preview.entryCount).toBe(1);
  });

  it("names the row when the file is ragged, the way the server does", async () => {
    await expect(
      apiClient.previewRosterImport(`;${ru(emptyPeriod[0]!)};${ru(emptyPeriod[1]!)}\r\nИгорь Петров;k32`),
    ).rejects.toThrow(/строка 2/);
  });

  it("refuses to apply over an occupied period unless overwrite is confirmed", async () => {
    const occupied = `;${ru(seededMonday)}\r\nИгорь Петров;k32`;

    const preview = await apiClient.previewRosterImport(occupied);
    expect(preview.existingCount).toBeGreaterThan(0); // the fixture seeds Monday

    await expect(
      apiClient.applyRosterImport(occupied, [{ csvName: "Игорь Петров", action: "create" }], false),
    ).rejects.toThrow(/уже есть/);

    const summary = await apiClient.applyRosterImport(
      occupied,
      [{ csvName: "Игорь Петров", action: "create" }],
      true,
    );
    // The seeded Monday holds three preset-backed shifts; all three are replaceable.
    expect(summary.entriesDeleted).toBeGreaterThan(0);
    expect(summary.entriesInserted).toBe(1);
  });
});
