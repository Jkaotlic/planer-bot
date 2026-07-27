import { describe, expect, it } from "vitest";
import * as appModule from "./App";
import type { RosterImportPreview, RosterPersonResolution } from "./api/client";

const preview: RosterImportPreview = {
  from: "2026-08-01",
  to: "2026-08-31",
  entryCount: 42,
  people: [
    { csvName: "Игорь Петров", suggestedEmployeeId: 2 },
    { csvName: "Новый Сотрудник", suggestedEmployeeId: null },
  ],
  unknowns: [],
  preservedCount: 0,
  existingCount: 0,
};

const app = appModule as unknown as {
  createInitialRosterResolutions: (value: RosterImportPreview) => RosterPersonResolution[];
  validateRosterResolutions: (value: RosterPersonResolution[]) => string | null;
  rosterImportBlocker: (state: {
    preview: RosterImportPreview;
    overwrite: boolean;
    resolutions: RosterPersonResolution[];
  }) => string | null;
  pluralRecords: (count: number) => string;
};

describe("roster import reconciliation", () => {
  it("keeps an exact employee match and creates an unmatched CSV person", () => {
    expect(app.createInitialRosterResolutions(preview)).toEqual([
      { csvName: "Игорь Петров", action: "rename", employeeId: 2 },
      { csvName: "Новый Сотрудник", action: "create" },
    ]);
  });

  it("rejects mapping two CSV rows to the same employee", () => {
    expect(
      app.validateRosterResolutions([
        { csvName: "Первый", action: "rename", employeeId: 2 },
        { csvName: "Второй", action: "rename", employeeId: 2 },
      ]),
    ).toBe("Один сотрудник выбран для нескольких строк CSV");
  });
});

describe("applying over a period that already has entries", () => {
  const resolutions = app.createInitialRosterResolutions(preview);

  it("blocks the apply until the admin ticks «перезаписать»", () => {
    const occupied = { ...preview, existingCount: 12 };
    expect(app.rosterImportBlocker({ preview: occupied, overwrite: false, resolutions }))
      .toBe("За этот период уже есть 12 записей — отметь «перезаписать», чтобы заменить их");
    expect(app.rosterImportBlocker({ preview: occupied, overwrite: true, resolutions })).toBeNull();
  });

  it("does not ask for confirmation when the period is empty", () => {
    expect(app.rosterImportBlocker({ preview, overwrite: false, resolutions })).toBeNull();
  });

  it("still refuses a double-claimed employee even with overwrite on", () => {
    expect(app.rosterImportBlocker({
      preview: { ...preview, existingCount: 3 },
      overwrite: true,
      resolutions: [
        { csvName: "Первый", action: "rename", employeeId: 2 },
        { csvName: "Второй", action: "rename", employeeId: 2 },
      ],
    })).toBe("Один сотрудник выбран для нескольких строк CSV");
  });
});

describe("pluralRecords", () => {
  it("declines «запись» the way Russian actually does", () => {
    expect([0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(app.pluralRecords)).toEqual([
      "0 записей", "1 запись", "2 записи", "5 записей",
      "11 записей", "12 записей", "14 записей",
      "21 запись", "22 записи", "25 записей",
      "101 запись", "111 записей",
    ]);
  });
});
