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
};

describe("roster import reconciliation", () => {
  it("keeps an exact employee match and creates an unmatched CSV person", () => {
    const createInitialRosterResolutions = (
      appModule as unknown as {
        createInitialRosterResolutions: (value: RosterImportPreview) => RosterPersonResolution[];
      }
    ).createInitialRosterResolutions;

    expect(createInitialRosterResolutions(preview)).toEqual([
      { csvName: "Игорь Петров", action: "rename", employeeId: 2 },
      { csvName: "Новый Сотрудник", action: "create" },
    ]);
  });

  it("rejects mapping two CSV rows to the same employee", () => {
    const validateRosterResolutions = (
      appModule as unknown as {
        validateRosterResolutions: (value: RosterPersonResolution[]) => string | null;
      }
    ).validateRosterResolutions;

    expect(
      validateRosterResolutions([
        { csvName: "Первый", action: "rename", employeeId: 2 },
        { csvName: "Второй", action: "rename", employeeId: 2 },
      ]),
    ).toBe("Один сотрудник выбран для нескольких строк CSV");
  });
});
