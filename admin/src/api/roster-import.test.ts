import { describe, expect, it } from "vitest";
import { apiClient } from "./client";

describe("development roster import client", () => {
  const csv = ";01.08.2026;02.08.2026\r\nИгорь Петров;k32;holiday\r\nНовый Сотрудник;k32-7;holiday";

  it("previews a selected CSV before any import is applied", async () => {
    const preview = await apiClient.previewRosterImport(csv);

    expect(preview).toEqual({
      from: "2026-08-01",
      to: "2026-08-02",
      entryCount: 2,
      people: [
        { csvName: "Игорь Петров", suggestedEmployeeId: 2 },
        { csvName: "Новый Сотрудник", suggestedEmployeeId: null },
      ],
      unknowns: [],
    });
  });
});
