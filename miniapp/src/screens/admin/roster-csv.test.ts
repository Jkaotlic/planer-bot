import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AppRoot } from "@telegram-apps/telegram-ui";
import type { RosterImportPreview, RosterPersonResolution } from "../../api/client";
import {
  AdminRosterCsv,
  formatPeriod,
  importBlocker,
  initialResolutions,
  monthRangeOf,
  pluralRecords,
  summaryLine,
} from "./AdminRosterCsv";

const preview: RosterImportPreview = {
  from: "2026-08-01",
  to: "2026-08-31",
  entryCount: 42,
  people: [
    { csvName: "Игорь Петров", suggestedEmployeeId: 2 },
    { csvName: "Новый Сотрудник", suggestedEmployeeId: null },
  ],
  unknowns: [],
  unknownsMessage: null,
  preservedCount: 0,
  existingCount: 0,
};

const employees = [
  { id: 2, displayName: "Игорь Петров", isAdmin: false, isActive: true, telegramUserId: 100002, birthDate: null, preferredName: null, address: "Игорь Петров", excludedFromAssignment: false, excludedFromSwaps: false },
  { id: 3, displayName: "Марк Волков", isAdmin: false, isActive: true, telegramUserId: null, birthDate: null, preferredName: null, address: "Марк Волков", excludedFromAssignment: false, excludedFromSwaps: false },
];

describe("initialResolutions", () => {
  it("keeps an exact match as a rename and makes the rest new people", () => {
    expect(initialResolutions(preview)).toEqual([
      { csvName: "Игорь Петров", action: "rename", employeeId: 2 },
      { csvName: "Новый Сотрудник", action: "create" },
    ]);
  });
});

describe("importBlocker", () => {
  const resolutions = initialResolutions(preview);

  it("lets an empty period through", () => {
    expect(importBlocker({ preview, overwrite: false, resolutions })).toBeNull();
  });

  it("holds an occupied period until «перезаписать» is ticked", () => {
    const occupied = { ...preview, existingCount: 12 };
    expect(importBlocker({ preview: occupied, overwrite: false, resolutions }))
      .toBe("За этот период уже есть 12 записей — отметь «перезаписать»");
    expect(importBlocker({ preview: occupied, overwrite: true, resolutions })).toBeNull();
  });

  it("still refuses two rows pointing at the same person, even with overwrite on", () => {
    const doubled: RosterPersonResolution[] = [
      { csvName: "Первый", action: "rename", employeeId: 2 },
      { csvName: "Второй", action: "rename", employeeId: 2 },
    ];
    expect(importBlocker({ preview: { ...preview, existingCount: 3 }, overwrite: true, resolutions: doubled }))
      .toBe("Один сотрудник выбран для нескольких строк");
  });
});

describe("pluralRecords", () => {
  it("declines «запись» the way Russian actually does", () => {
    expect([0, 1, 2, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(pluralRecords)).toEqual([
      "0 записей", "1 запись", "2 записи", "5 записей",
      "11 записей", "12 записей", "14 записей",
      "21 запись", "22 записи", "25 записей",
      "101 запись", "111 записей",
    ]);
  });
});

describe("monthRangeOf", () => {
  it("covers the whole month the given day falls in", () => {
    expect(monthRangeOf("2026-08-14")).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRangeOf("2026-06-01")).toEqual({ from: "2026-06-01", to: "2026-06-30" });
    expect(monthRangeOf("2026-02-28")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRangeOf("2028-02-05")).toEqual({ from: "2028-02-01", to: "2028-02-29" }); // високосный
  });
});

describe("formatPeriod / summaryLine", () => {
  it("writes dates the way the file does", () => {
    expect(formatPeriod("2026-06-01", "2026-06-30")).toBe("01.06.2026 — 30.06.2026");
  });

  it("mentions only what actually happened", () => {
    expect(summaryLine({ entriesInserted: 42, entriesDeleted: 0, cellsPreserved: 0, employeesCreated: 0 }))
      .toBe("CSV загружен: добавлено 42 записи");
    expect(summaryLine({ entriesInserted: 42, entriesDeleted: 5, cellsPreserved: 2, employeesCreated: 21 }))
      .toBe("CSV загружен: добавлено 42 записи, заменено 5 записей, не тронуто 2 записи, новых сотрудников — 21");
  });

  // Replacing a month can invalidate swaps somebody was still waiting on. Silence
  // here means the admin only learns about it when that person comes asking.
  it("says out loud that the overwrite invalidated pending swaps", () => {
    expect(summaryLine({ entriesInserted: 4, entriesDeleted: 4, cellsPreserved: 0, employeesCreated: 0, swapsExpired: 1 }))
      .toContain("1 заявка на обмен стала неактуальной — обеим сторонам написали");
    expect(summaryLine({ entriesInserted: 4, entriesDeleted: 4, cellsPreserved: 0, employeesCreated: 0, swapsExpired: 3 }))
      .toContain("3 заявок на обмен стали неактуальны");
    expect(summaryLine({ entriesInserted: 4, entriesDeleted: 4, cellsPreserved: 0, employeesCreated: 0, swapsExpired: 0 }))
      .not.toContain("обмен");
  });
});

describe("the screen as rendered", () => {
  // telegram-ui components refuse to render outside <AppRoot>, exactly as they do
  // in the real app (`main.tsx` wraps everything in one).
  const render = (props: Partial<Parameters<typeof AdminRosterCsv>[0]> = {}) =>
    renderToStaticMarkup(
      createElement(
        AppRoot,
        { appearance: "light", platform: "base" },
        createElement(AdminRosterCsv, {
          employees,
          today: "2026-08-14",
          onError: () => {},
          onNotice: () => {},
          onImported: () => {},
        onClose: () => {},
          ...props,
        }),
      ),
    );

  it("offers both directions before a file is picked", () => {
    const markup = render();
    expect(markup).toContain("⬆ Загрузить");
    expect(markup).toContain("⬇ Выгрузить");
    expect(markup).toContain("График файлом");
  });

  it("hides the file input rather than showing a raw browser control", () => {
    expect(render()).toContain('type="file"');
    expect(render()).toContain("display:none");
  });

  it("accepts only CSV so the picker does not offer photos", () => {
    expect(render()).toContain('accept=".csv,text/csv"');
  });
});
